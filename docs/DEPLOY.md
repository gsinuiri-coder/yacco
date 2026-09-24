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
