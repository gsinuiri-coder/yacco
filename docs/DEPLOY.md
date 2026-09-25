# Desplegar Yacco

Qué comando corre qué, y en qué orden. Los entornos y qué base mira cada uno
están en [`ENTORNOS.md`](./ENTORNOS.md); el porqué de cada decisión, en
[`ARQUITECTURA.md`](./ARQUITECTURA.md).

> **Estado:** migración terminada (fase 7). Producción es Cloud Run + Vercel y
> el deploy corre desde CI; Render está retirado. Lo que hay hecho está en
> [`PROGRESO.md`](./PROGRESO.md).

## Preparar la máquina, una vez

### 1. Las herramientas

`gcloud`, `vercel`, `neonctl`, `gh`, `docker`, `node` y `pnpm`. Para verificar
que Claude Code las encuentra y las puede lanzar sin shell:

```bash
node -e "import('./scripts/lib.mjs').then(m=>['gcloud','vercel','neonctl','gh'].forEach(c=>console.log(c, m.resolveCommand(c).file)))"
```

En Windows, el wrapper Bash de `gcloud` falla con `Python was not found`: nunca
define `CLOUDSDK_PYTHON` y Windows contesta con el stub de la Microsoft Store.
`scripts/lib.mjs` lo esquiva llamando al Python empaquetado del propio SDK
(D-003), así que **los scripts funcionan aunque `gcloud` a mano no**. Si querés
usar `gcloud` directo desde Git Bash:

```bash
export CLOUDSDK_PYTHON="$HOME/AppData/Local/Google/Cloud SDK/google-cloud-sdk/platform/bundledpython/python.exe"
```

### 2. Iniciar sesión en cada servicio

Una vez por máquina. Son interactivos: los corre una persona, no un agente.

```bash
gcloud auth login
gcloud auth application-default login
gh auth login
vercel login
neonctl auth
```

### 3. Completar `.env.setup`

```bash
cp .env.setup.example .env.setup
```

`.env.setup` está ignorado por git y **ningún agente lo lee ni lo escribe**:
`AGENTS.md` prohíbe leer o escribir archivos `.env*`. Lo completa una persona.

Valores ya decididos, listos para pegar:

```
GCP_PROJECT_ID=yacco-v2-prod
GCP_BILLING_ACCOUNT_ID=0148EC-33BCAA-9A4CED
GCP_REGION=us-east4
NEON_PROJECT_ID=late-union-50177487
NEON_ORG_ID=org-still-lake-04900241
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=30d
```

Falta conseguir `VERCEL_TOKEN` en vercel.com > Account Settings > Tokens. Ese
token es el único obligatorio: el deploy del web corre en GitHub Actions, donde
no hay sesión de `vercel login`. **No va a los secretos de GitHub**: después de
ponerlo en `.env.setup`, `pnpm secrets:gcp --upload=VERCEL_TOKEN` lo sube a
Secret Manager y CI lo lee de ahí (D-015). Para el resto alcanza con la sesión interactiva del paso 2.

Nada de esto bloquea: cuando el archivo no está, los scripts leen la
configuración del entorno del proceso (D-004), que es también como corren en
CI.

Después, generar los secretos de la aplicación y verificar:

```bash
pnpm secrets:generate   # escribe JWT_ACCESS_SECRET y JWT_REFRESH_SECRET sin imprimirlos
pnpm env:check          # lista qué falta, sin mostrar ningún valor
```

`secrets:generate` no pisa un valor que ya exista; para rotarlos, `--force`.
Los secretos son **nuevos**: rotarlos sólo invalida
sesiones abiertas, y hoy el único usuario es el dueño del repo.

Estos secretos son los del entorno **local**. Los de producción viven en Secret
Manager y no tienen por qué coincidir: ver D-007.

## Desarrollo local

```bash
pnpm env:local     # escribe apps/api/.env apuntando a Docker
pnpm demo:up       # Postgres + migraciones + seed, de un tirón
pnpm dev:api       # en una terminal
pnpm dev:web-nuxt  # en otra
```

`env:local` apunta **siempre** al Postgres de Docker, nunca a Neon, y averigua
el puerto real en vez de asumir 5432 (en la máquina del dueño está en 5433).

Para un ciclo con recarga, en dos terminales dentro de `apps/api`:
`pnpm dev:tsc` y `pnpm dev:node`. La API compila y corre el build de `dist/`
porque `tsx` no emite `emitDecoratorMetadata`, que la inyección de
dependencias de Nest necesita.

**Bajá la API antes de cualquier `prisma generate`:** con `dev:api` corriendo,
el engine queda tomado y la generación falla a mitad.

## Desplegar

### Preparar Google Cloud, una vez _(fase 2, ya hecho)_

```bash
pnpm gcp:bootstrap     # proyecto, facturación, APIs, Artifact Registry, service accounts, WIF
pnpm secrets:gcp       # sube los secretos a Secret Manager, por stdin, sin imprimirlos
```

Los dos son **idempotentes**: correrlos dos veces no rompe nada, no duplica
nada, y `secrets:gcp` no crea una versión nueva si el valor no cambió. Están
corridos: el estado resultante está en `PROGRESO.md`.

`secrets:gcp` le da al deployer de CI lectura sobre los secretos que usa. **De
`.env.setup` sólo sube lo que se le pide con `--upload`**, y hoy la única clave
permitida es `VERCEL_TOKEN`: hay que correr
`pnpm secrets:gcp --upload=VERCEL_TOKEN` cada vez que cambie el token. Los
`JWT_*` de `.env.setup` son los de local y el script se niega a subirlos
(D-007): los de producción viven sólo en Secret Manager.

`pnpm secrets:gcp --check` no escribe nada: valida la config, el proyecto de
GCP, las ramas de Neon y que cada secreto de runtime tenga una versión
legible (sólo metadatos, nunca el valor). Es el paso 0 de toda rotación de una
credencial de Neon (D-017): si falla, no se resetea nada.

**Quién lee qué (D-025).** Cada servicio corre con su identidad
(`yacco-api-run` producción, `yacco-api-demo-run` demo) y lee sólo sus cuatro
secretos. Para comprobarlo sin leer ningún valor, con el Policy Troubleshooter
(el nombre del recurso lleva el NÚMERO de proyecto, y `--billing-project`
evita que la llamada se cobre al proyecto por defecto de gcloud):

```bash
gcloud policy-intelligence troubleshoot-policy iam \
  //secretmanager.googleapis.com/projects/297699663114/secrets/yacco-production-jwt-access-secret \
  --principal-email=yacco-api-demo-run@yacco-v2-prod.iam.gserviceaccount.com \
  --permission=secretmanager.versions.access \
  --billing-project=yacco-v2-prod --format="value(overallAccessState)"
# → CANNOT_ACCESS
```

Si `gcp:bootstrap` falla con `PERMISSION_DENIED` en Artifact Registry justo
después de crear el proyecto, es propagación de IAM tras habilitar la API:
esperá un minuto y volvé a correrlo.

### Desde CI, que es el camino normal _(fase 5)_

Mergear a `main` despliega. `.github/workflows/deploy.yml` arranca cuando CI
termina bien sobre `main`, espera a que CodeQL también pase para ese commit, y
corre en este orden (D-014):

| Paso          | Qué hace                                                                                      | Si falla, qué queda en pie                           |
| ------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| gate          | Espera CI y CodeQL; sólo sigue si el commit es la punta de `main`                             | Nada cambió                                          |
| preflight     | Comprueba que existen los secretos, y que el token de Vercel sirve (`vercel whoami`)          | Nada cambió                                          |
| 1 integración | `pnpm test:integration` (Testcontainers) sobre el commit                                      | Nada cambió                                          |
| 2 migraciones | `prisma migrate deploy` contra la URL **directa**: demo, después main                         | Una o las dos bases migradas; código viejo sirviendo |
| 3 imagen      | `deploy-api.mjs build`: una imagen, etiquetada con el sha                                     | **Bases migradas, código viejo sirviendo**           |
| 4a demo       | `deploy-api.mjs deploy --env=demo` + smoke de esa API                                         | Producción en el código viejo                        |
| 4b producción | La MISMA imagen + smoke de esa API                                                            | Demo en el nuevo; web sin publicar                   |
| 5 web         | `deploy-web.mjs`: `vercel build --prod`, guardia del Build Output, `deploy --prebuilt --prod` | APIs en el nuevo; web en su versión anterior         |
| 6 smoke       | `pnpm smoke:prod`, solo lectura                                                               | Todo desplegado; el smoke dice qué no está sano      |

La fila del paso 3 es la que justifica una regla: **si las migraciones pasan y
la imagen falla, la base quedó migrada y el código viejo sigue sirviendo.** Por
eso las migraciones son expand/contract. Una que no se banque ese estado no se
mergea.

Nada de esto usa llaves guardadas en GitHub: entra a Google Cloud por Workload
Identity (sólo desde `main`) y lee de Secret Manager, en el job que lo usa, la
URL directa de cada rama y el token de Vercel (D-014, D-015).

**Relanzar** — por ejemplo, después de subir un secreto que faltaba:

```bash
gh workflow run deploy.yml --ref main
```

Pasa por el mismo gate: CI y CodeQL tienen que haber pasado para la punta de
`main`.

### A mano, cuando haga falta

Son los mismos scripts que corre CI, no una copia:

```bash
pnpm deploy:api --env=demo          # build + push + deploy: servicio yacco-api-demo
pnpm deploy:api --env=production    # ídem: servicio yacco-api, rama main de Neon
pnpm deploy:web                     # web a producción (yacco-web.vercel.app)
pnpm deploy:web --preview           # un preview: URL única, detrás del login de Vercel
```

`deploy:api` necesita Docker en la máquina; `deploy:web` no. Imprimen **sólo
la URL**. No corren migraciones: eso es sólo de CI.

**Siempre demo primero, verificar, y recién entonces producción.** `--env=`
tiene que escribirse: sin flag, el script cae en `demo` — a propósito, así el
despliegue a producción es algo que alguien escribió, no algo que se le
escapó.

El web es `apps/web-nuxt` (D-023): el proyecto `yacco-web` tiene
`rootDirectory: apps/web-nuxt` y construye con el `vercel.json` de esa
carpeta. El proxy por host son rutas del Build Output (D-011, D-021): el
dominio de producción de `yacco-web` va a `yacco-api`, cualquier otro host
—incluido cada preview— va a `yacco-api-demo`, y todo lo demás lo renderiza
la función SSR de Nuxt. `deploy:web` revisa esas rutas en
`.vercel/output/config.json` y no publica si falta la de producción o si va
después del default a demo.

### Verificar P-05: que cada host cae en la API correcta

`/health` viaja por la misma regla de host que `/api/*` (D-012) justamente
para poder comprobar esto desde afuera, sin mirar logs de ningún lado. Dos
pasos, cada uno contra un host distinto de `yacco-web`:

1. **El dominio de producción tiene que contestar `"production"`.** Este paso
   ya lo corre CI en cada deploy (`pnpm smoke:prod`). A mano:

   ```bash
   curl -s https://yacco-web.vercel.app/health
   # { "status": "ok", "commit": "...", "environment": "production" }
   ```

2. **Cualquier preview tiene que contestar `"demo"`.** CI no publica previews,
   así que este paso es manual y se corre una vez después del primer deploy
   desde CI. Un preview queda detrás de Vercel Authentication (D-011): sin
   sesión, `curl` recibe un 302 a `vercel.com/sso-api`. `vercel curl` arma la
   petición autenticada con la sesión de `vercel login`:

   ```bash
   pnpm deploy:web --preview
   vercel ls yacco-web --environment preview   # la URL del preview recién creado
   vercel curl "https://<preview>.vercel.app/health"
   # { "status": "ok", "commit": "...", "environment": "demo" }
   ```

   Dos detalles de la CLI 59.11.2, vistos el 2026-09-16: `deploy:web` imprime
   `}` en vez de la URL (la CLI devuelve JSON fuera de una terminal), por eso la
   URL sale de `vercel ls`; y `vercel curl /health --deployment <url>` falla en
   Windows con «Malformed input to a URL function», así que va la URL completa.

   O abrir `https://<preview>.vercel.app/health` en el navegador ya logueado en
   Vercel.

**Si cualquiera de los dos contesta `"environment": null`, PARAR.** Significa
que ese servicio de Cloud Run quedó desplegado sin `APP_ENV`. Hasta que
conteste un valor, el testigo no sirve: no se puede distinguir "está bien
configurado" de "no se pudo verificar". CI ya falla en ese caso.

### Las migraciones

Corren en un paso propio de CI, **antes** del deploy, contra `DIRECT_URL` — la
conexión directa, no la del pooler.

**Nunca al arrancar el contenedor.** Cloud Run levanta varias instancias y
todas correrían `migrate deploy` a la vez contra la misma base.

### Verificar

```bash
pnpm smoke:prod
```

**solo lectura** y sin ninguna credencial: `/health` de las dos APIs
(FALLA si `environment` vuelve `null`), `/health` por el dominio de producción
de Vercel, un login con un usuario inexistente que tiene que dar 401, y la
carga de las pantallas principales servidas por el Nuxt (`<div id="__nuxt">`,
su módulo `/_nuxt/*.js` y los headers anti-enmarcado): un web React falla.
**Nunca corre nada que escriba contra producción**, y no lleva ninguna
credencial. Con `EXPECTED_COMMIT=<sha>` además exige que las dos APIs estén en
ese commit; CI la pone.

Para una sola API (es el gate de CI después de cada deploy de Cloud Run):

```bash
node scripts/smoke.mjs api --env=demo
```

**La única credencial de un smoke es la de VIEWER.** El job 6 de
`deploy.yml` corre `smoke.mjs --require-viewer`: lee por WIF
`yacco-production-smoke-viewer-password` (el único secreto que el deployer
puede leer además de los del deploy) y hace un login válido de `smoke-viewer`,
rol VIEWER, que sólo ve catálogos y `/auth/me`. Si falta, el smoke FALLA. A
mano, sin `SMOKE_VIEWER_PASSWORD`, ese paso se saltea y lo avisa. Ningún smoke,
workflow ni script lee la contraseña del admin (lo verifica
`scripts/viewer-bootstrap.test.mjs`), así que rotarla (F) no rompe ninguno.

### Cuenta del smoke: bootstrap manual

Crear o reparar `smoke-viewer` pide un admin (igual que «Zonas del padrón»,
abajo; ningún otro paso lo usa). No corre en CI ni en el deploy: lo corre
una persona, en una terminal, y sólo cuando hace falta (la primera vez, o si el smoke dice que el login de
`smoke-viewer` falla):

```bash
GCP_PROJECT_ID=yacco-v2-prod pnpm viewer:bootstrap
# Contraseña ACTUAL del usuario admin de producción (no se muestra):
```

La contraseña del admin se escribe a mano, sin eco. El script no la lee de
Secret Manager ni del entorno, y sin una terminal interactiva no corre. Es
idempotente: si la cuenta y su secreto ya existen, no escribe nada. Después
hace el mismo chequeo que el smoke del deploy y le da al deployer
`secretAccessor` sobre ese secreto y sobre ningún otro. Los casos que no se
arreglan solos (cuenta desactivada, cuenta sin secreto, secreto ilegible)
abortan sin escribir nada y dicen qué hacer.

### Zonas del padrón: `pnpm roster:zones`

Les pone zona a los clientes del padrón a partir de sus etiquetas del sistema
viejo. Es un paso manual, como el de arriba, y entra por la API como admin
con la contraseña tecleada sin eco. Solo toca `zoneId`, y solo a quien no
tiene zona: una puesta a mano desde la ficha del cliente no se pisa.

1. Las etiquetas no están en `main` (el cargador no guarda las notas), así
   que salen del Firestore del sistema viejo, de solo lectura. En la máquina
   de Giancarlo:

   ```bash
   pnpm --filter @yacco/firestore-export export:tags -- --out <carpeta fuera del repo>
   # tags: N clientes, M con etiquetas -> <carpeta>/tags.json
   ```

   `tags.json` lleva solo el id de cada cliente y sus etiquetas: ni nombre, ni
   teléfono, ni deuda.

2. Dry-run (por defecto): imprime las etiquetas con cuántos clientes tiene
   cada una, las zonas a crear, cuántos clientes van a cada zona, los códigos
   de los que tienen dos etiquetas de lugar y cuántos quedan sin zona. No
   escribe nada.

   ```bash
   pnpm roster:zones -- --tags <carpeta>/tags.json
   ```

3. Si hay «etiquetas SIN CLASIFICAR», se agregan a
   `scripts/roster-zones-labels.json` (zona o no-zona, regla del supuesto 16)
   en un PR, y se vuelve al paso 2.
4. Con el informe aprobado (`[OK]`): `--commit`. Crea las zonas que falten
   (sin días de reparto: los pone el dueño en Zonas), asigna, y verifica de
   solo lectura que la cantidad de clientes con zona cierra y que ningún
   cliente cambió en otra cosa que la zona (huella por cliente, sin imprimir
   el contenido). Correrlo con la oficina sin trabajar: un cobro o una
   edición durante la corrida también cambian la huella, y la verificación
   falla (después de escribir, pero sin haber pisado nada).

   Frena ANTES de escribir si hay etiquetas sin clasificar, si una zona
   retirada recibiría clientes (se reactiva en Zonas o se saca del mapeo), o
   si la lista de clientes no se pudo leer completa.

**No uses `pnpm load:roster` para esto.** Su `upsert` vuelve a escribir el
nombre y el teléfono de cada cliente desde el CSV, y pisaría lo que la
oficina haya corregido en la app desde la carga (ver abajo, «El peligro de
recargar el padrón»).

### Saldos de envases de los clientes: saberlos o contarlos

Los 604 clientes del padrón entraron **sin envases**: el sistema viejo no
tenía saldos (supuesto 14). Cada ubicación figura «Sin contar» en «Envases en
poder de clientes» con 0 según el sistema. Hay dos caminos, y cuál sirve
depende de una sola pregunta al dueño: _¿usted sabe cuántos bidones tiene
cada cliente, o hay que ir a contarlos?_

**Si hay que contarlos (el camino de hoy).** Visita a visita, el chofer cuenta
lo que el cliente tiene y la oficina lo registra en «Envases en poder de
clientes»: se busca al cliente por nombre o teléfono (o se recorre por zona),
«Contar», se agrega el tipo de envase encontrado y se escribe lo contado.
Como el sistema dice 0, la pantalla muestra la diferencia («según el sistema
0, contado 3 (diferencia +3)») y pide confirmar; al confirmar queda un conteo
y un movimiento `COUNT_ADJUSTMENT` que lleva el saldo a lo contado. La fila
deja de decir «Sin contar». No hace falta ninguna herramienta ni tocar la API.
El avance de arriba («N de M ubicaciones contadas») dice cuánto falta.

**Si el dueño los sabe de antemano (una planilla por cliente).** El camino
pensado para eso es el CSV `opening_containers.csv` de `pnpm load:roster`:
una fila por ubicación con `qty_spout`, `qty_no_spout` y `confidence`. Cada
cantidad entra como `OPENING_BALANCE` a la fecha de corte, y:

- con `confidence = HIGH` (el dueño está seguro) el cargador además registra
  un conteo de confirmación con esa misma cantidad, así que la ubicación
  queda como **contada**: no hace falta ir a contarla;
- con `confidence = ESTIMATED` queda el saldo pero la ubicación sigue «Sin
  contar», para verificarla en la próxima visita.

**El peligro de recargar el padrón.** `load:roster` no carga solo envases:
lee los cuatro CSV y hace `upsert` de cada cliente y cada ubicación que
nombran. Sobre un padrón que ya está en `main`, eso **vuelve a escribir desde
el CSV el nombre del cliente, su zona (la deja vacía si la columna `zone` no
la trae, borrando lo que asignó `roster:zones` o la oficina), y el nombre, la
dirección, la referencia y el teléfono de cada ubicación**. Todo lo corregido
en la app desde el 2026-09-24 se pierde sin aviso. No hay hoy una
herramienta que arme los CSV desde `main`, y el export y los CSV originales
se borraron. Así que, con el padrón ya cargado, **los saldos que el dueño
sepa se registran igual que un conteo, desde la pantalla**, con la cantidad
que él da: el resultado es el mismo (ubicación contada, saldo correcto), solo
que el movimiento es `COUNT_ADJUSTMENT` y no `OPENING_BALANCE`. Si alguna vez
se quisiera cargar por CSV, primero hace falta un cargador que solo agregue
saldos y no toque clientes, y eso es trabajo nuevo, no una corrida.

## Vuelta atrás

**El web** (D-023): promover en Vercel un deploy anterior de `yacco-web`, con
`vercel promote <deploy> --scope gsinuiricoders-projects` o con «Instant
Rollback» / «Promote to Production» en el dashboard. No reconstruye nada.
Después, avisar; nada de arreglos improvisados.

**Volver adelante tiene una trampa.** Después de un Instant Rollback, los
deploys nuevos de producción NO toman el dominio: el `deploy --prebuilt --prod`
del job 5 crea el deploy, pero `yacco-web.vercel.app` sigue sirviendo el del
rollback hasta que alguien hace «Undo Rollback» en el dashboard o
`vercel promote <deploy nuevo>`. Cerrar siempre un rollback con uno de los dos.

**El smoke lo detecta** si el rollback fue al web React (el de D-023): exige el
HTML del Nuxt en `/`, `/login` y `/customers/new`, así que el job 6 falla
mientras el dominio siga en el React. Si el rollback fue a otro deploy del
Nuxt, NO lo distingue: `/health` por el dominio lo contesta la API, que sí
está en el commit nuevo.

Render ya no es vuelta atrás: quedó vivo pero sin acceso a la base desde la
rotación de `main` (D-017, fase 7).

## Reglas que no se negocian

- Ningún valor secreto se imprime. Si un comando puede imprimir uno al salir
  bien (`neonctl connection-string`, `gcloud secrets versions access`,
  `vercel env pull`), se llama con `quiet: true`.
- Ninguna credencial viaja por argv: `--token` nunca. Los CLI leen su token del
  entorno del proceso hijo.
- Ningún test que escriba corre contra producción.
- Nunca `git push --force`, nunca `--admin` en un merge, nunca un merge con un
  check en rojo.
- `prisma migrate reset` sólo contra el Postgres local de Docker, y con
  confirmación humana.
- Una migración ya aplicada está congelada: no se edita ni un comentario.
