# Arquitectura de infraestructura

Dónde corre Yacco y por qué. **Esto es un documento de infraestructura.** No
describe el producto ni sus reglas de negocio: la fuente de verdad de eso es
[`yacco-documentacion.md`](./yacco-documentacion.md), que tiene las historias
de usuario, los criterios de aceptación y la tabla de endpoints. Si buscás qué
hace un endpoint, andá allá. Acá está dónde vive el proceso que lo atiende.

## Estado

Migración de Render a Google Cloud Run (API) + Vercel (web), en curso. El
avance por fase está en [`PROGRESO.md`](./PROGRESO.md); cómo desplegar, en
[`DEPLOY.md`](./DEPLOY.md); qué entornos existen y qué base mira cada uno, en
[`ENTORNOS.md`](./ENTORNOS.md).

## Arquitectura objetivo

```
                    ┌──────────────────────────────────────┐
   navegador ──────▶│ Vercel — proyecto yacco-web          │
   (Lima)           │ SPA estática: apps/web/dist          │
                    │                                      │
                    │ vercel.json:                         │
                    │  /api/*, /health ──────┐             │
                    │  /(.*)      ──▶ index.html (Router)  │
                    └────────────────────────┼─────────────┘
                                             │  HTTPS, servidor a servidor.
                                             │  El navegador nunca ve este
                                             │  salto: para él todo es
                                             │  mismo origen.
                                             ▼
                    ┌──────────────────────────────────────┐
                    │ Google Cloud Run — us-east4 (Ashburn)│
                    │ servicio yacco-api (producción)      │
                    │ servicio yacco-api-demo (ensayo)     │
                    │                                      │
                    │ NestJS, imagen del Dockerfile del    │
                    │ monorepo, escucha en $PORT           │
                    │ Secretos montados desde Secret       │
                    │ Manager, nunca horneados en la imagen│
                    └────────────────────┬─────────────────┘
                                         │  DATABASE_URL (pooled)
                                         ▼
                    ┌──────────────────────────────────────┐
                    │ Neon — aws-us-east-1 (N. Virginia)   │
                    │ proyecto yacco-production            │
                    │ rama main   → producción             │
                    │ rama demo   → ensayo y previews      │
                    └──────────────────────────────────────┘

   GitHub Actions ──WIF (sin llaves, sólo main)──▶ Google Cloud
                                                    │
                     Secret Manager, leído en el job que lo usa:
                     ├─ yacco-{demo,production}-direct-url ──▶ Neon (prisma migrate deploy)
                     └─ yacco-ci-vercel-token ───────────────▶ Vercel (deploy --prebuilt)

   Los secretos de GitHub no guardan NINGUNA llave (D-014, D-015).
```

Lo que cambia respecto de hoy, en una línea: **el navegador deja de hablar con
dos orígenes y pasa a hablar con uno solo.** Hoy la web en Render llama a
`https://yacco-api.onrender.com/api/v1` y cada llamada es cross-origin, con su
preflight y su CORS. Con el rewrite de Vercel, la web llama a `/api/v1` —
mismo origen— y es Vercel quien reenvía a Cloud Run por detrás.

## Registro de decisiones

Formato: contexto, decisión, alternativas descartadas. Una decisión registrada
no se vuelve a discutir en cada PR; se revisa cuando cambia su contexto.

---

### D-001 — Proyecto de GCP nuevo, separado del Yacco viejo

**Contexto.** Ya existe un proyecto `yacco-2026` (número 1091068368033) con
facturación activa. No está vacío: tiene habilitadas unas cuarenta APIs de
Firebase, Firestore, BigQuery y App Engine. Es el Yacco anterior, el que corría
sobre Firestore — en este mismo repo queda `tools/firestore-export/`, la
herramienta que se escribió para sacar los datos de ahí.

**Decisión.** Crear un proyecto nuevo para Yacco v2 y dejar `yacco-2026`
intacto. Vincularlo a la cuenta de facturación `0148EC-33BCAA-9A4CED`
("pago firebase 02"), elegida por el dueño para que el gasto de v2 quede
separado del de los proyectos Firebase.

**Alternativas descartadas.**

- _Reutilizar `yacco-2026`._ Cero proyectos nuevos, pero v2 hereda la
  superficie de IAM y las cuotas de un proyecto Firebase que no controla, y el
  día que se quiera borrar el Yacco viejo habría que desenredar los dos.
- _Un proyecto por entorno (prod y demo separados)._ Aislamiento más fuerte,
  pero duplica WIF, Artifact Registry y Secret Manager para un sistema cuyo
  único usuario hoy es el dueño. Prod y demo conviven como dos servicios de
  Cloud Run en el mismo proyecto; si algún día hay tráfico real, partirlos es
  un cambio acotado.

---

### D-002 — Cloud Run en `us-east4`, no en `us-east1`

**Contexto.** La base de datos es el camino caliente: cada request de Yacco
hace varias queries, y en un flujo como cerrar una liquidación de ruta son
muchas más. Cada ida y vuelta a Postgres paga la latencia entre el servicio y
la base. Hoy la API está en Render `virginia`, cerca de Neon, y esa cercanía es
parte de por qué la app responde como responde.

**El dato.** El proyecto Neon `yacco-production` (`late-union-50177487`) vive
en `aws-us-east-1`, que es **Norte de Virginia, zona de Ashburn**. Verificado
con `neonctl projects list`, campo `region_id`.

**Decisión.** Cloud Run en `us-east4`. `us-east4` es Ashburn, Virginia: el
mismo corredor de centros de datos que `aws-us-east-1`, típicamente un par de
milisegundos de ida y vuelta.

**Alternativas descartadas.**

- _`us-east1`._ Es Moncks Corner, Carolina del Sur, a unos 700 km de Ashburn.
  Suele ser algo más barata, pero agrega latencia a cada query de cada request,
  que es exactamente lo que no queremos multiplicar.
- _Una región sudamericana (`southamerica-west1`, Santiago)._ Acerca el
  servicio a los usuarios de Lima y aleja la base unos 6.000 km. Como el
  navegador hace una petición y el servidor hace varias queries por petición,
  mover el cómputo lejos de la base empeora el total: se cambia un salto lento
  por muchos. La forma correcta de acercarse a Lima sería mover **Neon y Cloud
  Run juntos**, y eso es una migración de datos, no una de hosting.

---

### D-003 — Los scripts lanzan los CLI sin shell, resolviendo el ejecutable real

**Contexto.** `scripts/lib.mjs#run` tiene que lanzar `gcloud`, `vercel`,
`neonctl` y `gh` desde Node, en Windows, pasando credenciales por entorno y sin
que nada termine en un historial de shell. Dos obstáculos concretos aparecieron
al hacerlo:

1. En Windows, `vercel` y `neonctl` en el PATH son shims `.cmd`, y Node se
   niega a lanzar un `.cmd` sin `shell: true` desde la corrección de
   CVE-2024-27980.
2. El wrapper Bash de `gcloud` que trae el SDK falla en la máquina del dueño
   con `Python was not found`: nunca define `CLOUDSDK_PYTHON`, y Windows
   responde con el stub de la Microsoft Store en vez del Python real. El SDK
   trae su propio intérprete y el wrapper no lo usa.

**Decisión.** `resolveCommand` traduce cada nombre lógico a algo lanzable con
`shell: false`: los CLI de npm se resuelven a su entrypoint JavaScript (leído
del campo `bin` de su `package.json`, no de una ruta fija) y corren bajo el
`node` actual; `gcloud` se resuelve al `python.exe` empaquetado del SDK contra
`lib/gcloud.py`, que es lo mismo que hace el shim `.cmd`; el resto se busca en
el PATH como ejecutable nativo.

**Alternativas descartadas.**

- _`shell: true`._ Una línea en vez de cincuenta, y reintroduce exactamente la
  clase de bug que la corrección de Node cerró, en los scripts que manejan
  credenciales.
- _Exigirle al dueño que arregle su PATH o instale Python._ Traslada a una
  persona un problema que el código puede resolver, y volvería a aparecer en
  cualquier máquina nueva.

---

### D-004 — La configuración efectiva es `.env.setup` por debajo y el entorno por encima

**Contexto.** Los mismos scripts tienen que correr en dos lugares: la máquina
del dueño, donde las credenciales viven en `.env.setup`, y GitHub Actions,
donde ese archivo no existe y cada valor llega como variable de entorno desde
los secretos del repositorio.

**Decisión.** `loadConfig()` lee `.env.setup` y luego deja que el entorno del
proceso pise lo que defina no vacío. Ningún script necesita saber en cuál de
los dos entornos está, y la ausencia del archivo deja de ser un error. Sólo se
consideran variables de entorno no vacías: una exportada en blanco no debe
tapar un valor real del archivo.

**Alternativas descartadas.**

- _Escribir un `.env.setup` en CI desde los secretos._ Materializa credenciales
  en el disco del runner para nada.
- _Dos caminos de código, uno por entorno._ El que menos se ejerce se rompe sin
  que nadie lo note.

---

### D-005 — Las reglas de infraestructura van en `.agents/rules/infra.md`, no dentro de `AGENTS.md`

**Contexto.** `AGENTS.md` tiene 11.256 caracteres sobre un tope de 12.000: 744
de margen. La sección de reglas de infraestructura y secretos que esta
migración necesita no entra ahí ni recortada, y recortar reglas existentes para
hacerle lugar no es una opción — son reglas que gobiernan código vivo.

**Decisión.** Las reglas nuevas viven en `.agents/rules/infra.md`, y `AGENTS.md`
gana sólo una línea que apunta ahí. `AGENTS.md` sigue siendo la fuente única:
lo que cambia es que ahora delega un capítulo, igual que ya delega el protocolo
de sync.

**Alternativas descartadas.**

- _Subir el tope._ El tope existe porque el archivo se lee entero en cada
  sesión de agente; subirlo es empeorar lo que el tope protege.
- _Comprimir reglas existentes._ Cada una de esas reglas tiene detrás un
  incidente concreto, y el detalle es lo que las hace aplicables.

---

### D-006 — La rama `demo` de Neon es hija de `main`, y el flujo va en un solo sentido

**Contexto.** El proyecto Neon tenía **una sola rama, `main`**. El servicio de
ensayo y los previews de Vercel necesitan una base propia: un preview que pegue
a la base de producción escribe en producción.

**Decisión.** `demo` (`br-dawn-field-autu1p5w`) creada como rama hija de `main`.
Nace con una copia del esquema y de los datos del momento, que es justo lo que
un ensayo necesita. **El flujo es en un solo sentido:** `main` puede refrescar
`demo` con `neonctl branches reset`; nada de lo escrito en `demo` vuelve a
`main`. Borrar ramas de Neon está denegado en `.claude/settings.json`.

**Alternativas descartadas.**

- _Un proyecto Neon aparte para demo._ Aislamiento mayor, pero pierde lo único
  que hace útil a la demo: partir de datos que se parecen a los reales.
- _Compartir `main` entre demo y producción._ Es exactamente el error que esta
  migración tiene que evitar.

#### Procedimiento: restaurar `main` desde una rama de respaldo

Escrito para el día en que haga falta, que no es el día para descubrirlo.
Fuentes: la ayuda de `neonctl` 4.15.0 y la guía de Neon «Instant restore»
(neon.com/docs/guides/branch-restore), leídas el 2026-09-16. Lo corre una
persona: borrar o restaurar ramas no lo hace ningún agente.

**Antes de restaurar, lo que se pierde.** Mientras Render siga vivo (hasta la
fase 7), Render ESCRIBE en `main` con usuarios reales, y desde el primer deploy
de CI también `yacco-api`. Restaurar `main` a la cabeza del respaldo **descarta
de `main` todo lo escrito entre la creación del respaldo y la restauración**. No
desaparece del todo: queda en la rama preservada (paso 2), de donde habría que
recuperarlo a mano, fila por fila. Si eso importa, primero se corta la escritura
(fase 7: Render suspendido; hoy: avisar al dueño de la planta) y después se
restaura.

**1. El respaldo, antes del cambio riesgoso.**

```bash
neonctl branches create --project-id late-union-50177487 \
  --parent main --name backup-<motivo>-<AAAAMMDD> \
  --no-compute --no-secrets
```

- `--no-secrets`: sin él, `branches create` imprime la contraseña de la
  conexión.
- `--no-compute`: un respaldo no necesita compute, así que no genera costo de
  cómputo.
- Anotar en `PROGRESO.md` el nombre y la HORA de creación (UTC). La hora sirve
  para el plan B del paso 2.

**2. Restaurar `main`.**

```bash
neonctl branches restore main backup-<motivo>-<AAAAMMDD> \
  --project-id late-union-50177487 \
  --preserve-under-name main_before_restore_<AAAAMMDD>
```

- **`--preserve-under-name` es OBLIGATORIO**, porque `main` tiene una rama hija
  (`demo`). Neon lo exige cuando el destino tiene hijas, y lo que preserva es el
  estado de `main` justo antes de restaurar: ahí queda lo escrito después del
  respaldo.
- **La conexión de `main` no cambia.** Neon mueve el compute a la rama nueva y
  le pone el nombre `main`: ni Render, ni Cloud Run, ni los secretos necesitan
  tocarse. Las conexiones abiertas se cortan durante la operación y se
  reconectan solas.
- **Plan B, sin rama de respaldo o si Neon rechaza la anterior:** restaurar
  `main` a su propia historia, a la hora anotada en el paso 1. El proyecto
  guarda **6 horas** de historia (`history_retention_seconds: 21600`).

  ```bash
  neonctl branches restore main ^self@<AAAA-MM-DDTHH:MM:SSZ> \
    --project-id late-union-50177487 \
    --preserve-under-name main_before_restore_<AAAAMMDD>
  ```

**3. El paso que se olvida: `demo` quedó colgando de la rama preservada.**

Al restaurar, Neon mueve TODAS las hijas de `main` a la rama preservada. Desde
ese momento `demo` es hija de `main_before_restore_<AAAAMMDD>`, no de la `main`
restaurada. No da ningún error, y ahí está el peligro: el refresco de siempre,
`neonctl branches reset demo --parent`, copia desde la rama preservada, que
tiene justo el estado que se quiso descartar.

**Neon no permite re-parentar una rama:** `neonctl branches` no tiene ningún
comando para cambiar el padre, y una rama hija no puede ser destino de un
restore. La única forma de volver a tener `demo` como hija de `main` es
recrearla, y recrearla le cambia el endpoint y la cadena de conexión:

```bash
# 3a. Liberar el nombre sin borrar nada: la vieja sigue viva con su endpoint,
#     así el servicio yacco-api-demo sigue andando mientras tanto.
neonctl branches rename demo demo_orphan_<AAAAMMDD> --project-id late-union-50177487

# 3b. La demo nueva, hija de la main restaurada, CON compute (la usa Cloud Run).
neonctl branches create --project-id late-union-50177487 \
  --parent main --name demo --no-secrets

# 3c. Nuevas URLs de demo a Secret Manager. secrets:gcp pide a neonctl la
#     conexión de la rama llamada `demo`, que ahora es la nueva; ve que el
#     valor cambió y crea una versión nueva sin imprimirla. Sin --upload: los
#     JWT de producción se leen de Secret Manager y no se tocan.
pnpm secrets:gcp

# 3d. Que yacco-api-demo tome las URLs nuevas. Los secretos van montados como
#     :latest y se leen al arrancar cada instancia; relanzar el deploy crea
#     una revisión nueva.
gh workflow run deploy.yml --ref main
```

Después de 3d, en el smoke de demo (`node scripts/smoke.mjs api --env=demo`),
el login rechazado con 401 prueba que la API llega a la rama nueva.

- **Actualizar el id de la rama** en D-006, en `ENTORNOS.md` y en `PROGRESO.md`:
  hoy dicen `br-dawn-field-autu1p5w`, y la demo recreada tiene otro.
- **`demo_orphan_<AAAAMMDD>` y `main_before_restore_<AAAAMMDD>` los borra una
  persona**, cuando ya no haga falta recuperar nada de ahí. Borrar ramas de Neon
  está denegado para los agentes en `.claude/settings.json`.

---

### D-007 — Secret Manager es la fuente de verdad de los secretos de producción

**Contexto.** El plan original hacía nacer `JWT_ACCESS_SECRET` y
`JWT_REFRESH_SECRET` en `.env.setup` y de ahí subirlos. Pero `AGENTS.md`
prohíbe al agente leer o escribir archivos `.env*` —y esa regla manda—, así que
el agente no puede poblar ese archivo. Además, un secreto de producción que
vive en un archivo plano en una laptop es más fácil de filtrar que uno que
nunca tocó ese disco.

**Decisión.** `pnpm secrets:gcp` resuelve cada secreto de aplicación en
cascada: **lo que YA esté en Secret Manager; si no hay nada, uno nuevo al azar
de 48 bytes**, que se sube sin imprimirse y sin escribirse en ningún lado.

> **Corrección, 2026-09-16.** La cascada original empezaba por «lo que diga la
> configuración». Eso volvía peligroso correr `secrets:gcp` desde una máquina
> con un `.env.setup` completo: los `JWT_*` de ese archivo son los del entorno
> LOCAL (los escribe `pnpm secrets:generate`), y subirlos ROTA los secretos de
> producción —se invalidan todas las sesiones— y los deja iguales a los de
> local, que es lo que esta decisión separa.
>
> **El mecanismo: los JWT de producción ya no tienen ningún camino desde la
> configuración.** `resolveApplicationSecret` no recibe la configuración: lee
> lo que haya en Secret Manager y, si no hay nada, genera uno al azar. No hay
> flag, clave ni archivo que haga que un JWT de `.env.setup` llegue a
> producción. Eso no EVITA el error: lo hace IMPOSIBLE, que es distinto.
> Un filtro se puede saltear o configurar mal; un camino que no existe, no.
>
> **El segundo cinturón: la lista explícita.** Lo único que el script sube
> desde la configuración es `UPLOADABLE_FROM_CONFIG` (hoy sólo `VERCEL_TOKEN`),
> y sólo lo pedido con `--upload`. Pedir un `JWT_*` falla diciendo por qué, y
> pedir cualquier otra clave fuera de la lista también falla. No es lo que
> protege a los JWT —eso ya lo hace el párrafo anterior—: es lo que impide que
> la próxima clave que alguien agregue a `.env.setup` termine subida sin que
> nadie lo haya decidido. Un valor vacío tampoco se sube nunca: un secreto
> vacío pasaría el preflight del deploy, que sólo mira presencia (D-015).
>
> Todo vive en el script y tiene test (`scripts/secrets-gcp.test.mjs`): no
> depende de que quien lo corre conozca esta historia.

Ese orden es lo que hace que correr el script dos veces no rote nada, y eso
importa: un secreto rotado sin querer invalida todas las sesiones abiertas. Los
secretos de `.env.setup` siguen existiendo para el entorno **local**, y no
tienen por qué coincidir con los de producción — son entornos distintos.

**Alternativas descartadas.**

- _Pedirle al dueño que complete `.env.setup` antes de poder avanzar._ Bloquea
  toda la fase 2 por un archivo, y termina con secretos de producción en una
  laptop igual.
- _Generar en cada corrida._ Rotaría los secretos cada vez que alguien corre el
  script, que es una trampa esperando a que haya usuarios reales.

---

### D-008 — `--min-instances=1` en producción, `0` en demo

**Contexto.** Con `0`, la primera request de la mañana paga el arranque en
frío, y es justo cuando el dueño abre la app en la planta. Con `1`, se paga una
instancia encendida las 24 horas.

**El dato, medido en Cloud Run y no estimado.** De los logs del servicio, desde
que Cloud Run arranca la instancia hasta que la sonda TCP la da por viva:

```
+17,2 s   Starting new instance — DEPLOYMENT_ROLLOUT
+22,1 s   Nest application starting        <- 4,9 s antes de la primera línea de Nest
+23,3 s   listo, STARTUP TCP probe OK      <- Nest en sí tardó 951 ms
```

**Arranque en frío ≈ 6,1 s.** Peor que los 4,0 s medidos en local y peor que
los 5,4 s de Render despertando de su suspensión. Lo revelador es el reparto:
**4,9 de esos 6,1 segundos pasan antes de que Nest imprima nada.** No es la
aplicación: es descarga de imagen, arranque de contenedor y carga del cliente
de Prisma.

**Decisión.** `--min-instances=1` en producción y `0` en demo, donde nadie
espera. Seis segundos es demasiado para la primera pantalla del día: esa
primera impresión es la que decide si la herramienta "anda lenta". Una
instancia de 512 MiB encendida cuesta poco, y hoy no hay tráfico que justifique
optimizar el costo antes que la experiencia.

**Alternativas descartadas.**

- _`0` en los dos._ Más barato, y le regala al dueño seis segundos de espera
  cada mañana.
- _Sólo adelgazar la imagen y dejar `0`._ Se hizo lo que se pudo —603 a 541 MB
  borrando los motores de Prisma que este proyecto no usa y TypeScript, que
  `pnpm deploy --prod` arrastra como peer opcional— y no alcanza: el resto del
  arranque no es la imagen. Vale la pena igual, porque también acorta cada
  arranque de cada instancia nueva cuando la app escale.

---

### D-009 — El commit desplegado viaja en `DEPLOYED_COMMIT`, con `RENDER_GIT_COMMIT` de reserva

**Contexto.** `/health` publica el commit del build corriendo para poder
comparar en segundos lo desplegado contra el tip de `main`. Existe porque un
auto-deploy que nunca disparó ya pasó desapercibido una vez (2026-08-24).
Render inyecta `RENDER_GIT_COMMIT` por su cuenta; **Cloud Run no inyecta nada
equivalente**, y eso se verificó en un deploy real: `/health` contestó
`commit: null`.

**Decisión.** `HealthService.deployedCommit()` lee `DEPLOYED_COMMIT` primero y
cae a `RENDER_GIT_COMMIT`. El nombre no menciona plataforma porque sobrevive a
esta migración, y el fallback es lo que deja al mismo código servir a los dos
hosts durante los 7 días en que Render sigue vivo como vuelta atrás — Render
inyecta el suyo solo y no se puede apagar. `pnpm deploy:api` pasa el sha al
desplegar.

Sigue sin haber ningún fallback que lea git desde el proceso: un contenedor no
tiene repositorio, y un valor plausible pero falso es peor que `null`, porque
el sentido del campo es que se le pueda creer cuando difiere de `main`.

---

### D-010 — Swagger apagado salvo que se lo encienda a propósito

**Contexto.** `main.ts` montaba la UI de Swagger en `/api/docs`
incondicionalmente. En producción eso publica el mapa completo de la API —cada
ruta, cada forma de cuerpo, cada rol— a quien pase por ahí.

**Decisión.** Se monta sólo con `ENABLE_SWAGGER === "true"`. **El default es
apagado**: un host donde nadie se acordó de poner la variable queda en el caso
seguro, no en el expuesto. El deploy no pasa `"false"` siquiera — ausente ya es
apagado, y así nadie lo "corrige" a mano.

Se saltea también la CONSTRUCCIÓN del documento, no sólo el `setup`:
`createDocument` recorre todos los controllers al arrancar, y eso es tiempo de
arranque en frío que Cloud Run paga en la primera request de la mañana (D-008).

**Alternativa descartada.** _Protegerlo con autenticación en vez de apagarlo._
Más trabajo, más superficie, y nadie lo necesita en producción: para leer la
API está la tabla de endpoints en `yacco-documentacion.md`.

> **Nota al pasar, no arreglada acá.** `AGENTS.md` referencia
> `.agents/rules/sync-protocol.md`, y ese archivo no existe: el contenido vive
> en `.agents/skills/sync-protocol/SKILL.md`. Está fuera del alcance de esta
> migración, pero conviene corregir la referencia en algún PR de
> documentación.

---

### D-011 — Solo el dominio de producción del proyecto cuenta como producción; las URLs generadas van a demo

**Contexto.** El rewrite de `/api/*` elige destino por host: el host de
producción va a `yacco-api`, **cualquier otro host va a `yacco-api-demo`**
(P-05). Pero Vercel sirve un mismo deploy de producción en varios hosts, y la
regla tiene que decir cuáles cuentan. Si no, el mismo build muestra datos
distintos según por dónde se entre, sin que nada lo avise.

**Los hosts, medidos y no supuestos.** El proyecto `yacco-web` **todavía no
existe** en Vercel: hoy no hay ningún host de producción. Vive en el team
`gsinuiricoders-projects`, y este es el patrón que siguen los proyectos que ya
están en ese team, probado el 2026-09-16 con `curl` sobre `gsm-inventory`:

| Host                                    | Qué es                                   | Sin sesión de Vercel       |
| --------------------------------------- | ---------------------------------------- | -------------------------- |
| `<proyecto>.vercel.app`                 | dominio de producción                    | **público**                |
| `<proyecto>-<team>.vercel.app`          | alias del team                           | 302 a `vercel.com/sso-api` |
| `<proyecto>-git-main-<team>.vercel.app` | alias de la rama                         | 302 a `vercel.com/sso-api` |
| `<proyecto>-<hash>-<team>.vercel.app`   | URL única de **un** deploy de producción | 302 a `vercel.com/sso-api` |
| `<proyecto>-<hash>-<team>.vercel.app`   | URL única de un deploy de preview        | 302 a `vercel.com/sso-api` |

Hay dos datos en esa tabla que deciden la regla:

1. **Las dos últimas filas tienen la misma forma.** Por el host no hay manera
   de distinguir la URL única de un deploy de producción de la de un preview.
2. **Lo único público es el dominio de producción.** El resto queda detrás de
   Vercel Authentication (la Standard Protection que viene por defecto): solo
   entra un miembro del team, y hoy ese miembro es el dueño.

Que `<proyecto>.vercel.app` sea el nombre depende de que esté libre:
`inventory`, en el mismo team, terminó con `inventory-gsinuiricoders-projects.vercel.app`
como dominio de producción porque `inventory.vercel.app` ya era de otro.
`yacco-web.vercel.app` hoy contesta `DEPLOYMENT_NOT_FOUND`, que sugiere que está
libre, pero eso recién se confirma al crear el proyecto.

**Actualización, 2026-09-16.** El proyecto `yacco-web` ya existe
(`vercel project add yacco-web`, sin ningún deploy todavía). `yacco-web.vercel.app`
sigue contestando `DEPLOYMENT_NOT_FOUND` — ya no por libre, sino porque el
proyecto no tiene ningún deploy — y es el nombre reservado para él: nadie más
puede tomarlo. Es el valor que usa `vercel.json` (D-012).

**Decisión.** Cuenta como producción **solo el dominio de producción del
proyecto** (el que Vercel lista en Settings > Domains), escrito en
`vercel.json` como **string literal**, sin regex. Todo lo demás —alias del
team, alias de rama y URLs únicas, sean de producción o de preview— va a
demo. El valor exacto se copia de lo que Vercel asigne al crear `yacco-web`,
no de esta tabla.

Por qué:

- **Admitir las URLs únicas de producción obliga a admitir los previews.**
  Cualquier patrón que case con `yacco-web-<hash>-gsinuiricoders-projects.vercel.app`
  casa también con los previews, y eso manda un preview a la base de
  producción: la regla de `.agents/rules/infra.md` que esta decisión no puede
  romper. El error en un sentido muestra demo; en el otro escribe en
  producción.
- **Los hosts que quedan afuera no los usa nadie de la planta.** Están detrás
  del login de Vercel. Que el dueño vea datos de demo al abrir el link único de
  un deploy es la conducta útil: es la forma de mirar un build sin tocar
  producción.
- **Sigue a los promote y a los rollback.** `vercel promote` y
  `vercel rollback` mueven el dominio de producción hacia otro deploy, no
  cambian el host. La regla vale para el deploy que esté detrás en cada
  momento, sin reescribir `vercel.json`.
- **Literal y no regex:** un host de más en una regex es una forma nueva y
  silenciosa de llegar a producción. Un literal de menos, en cambio, sirve
  demo: el sentido del error que ya elegimos.

**Condición de la que depende.** La Standard Protection tiene que seguir
activa en `yacco-web`. Si alguien la apaga, las URLs generadas quedan públicas
y muestran demo a quien las abra. No escribe en la base equivocada, pero
alguien de la planta podría cargar datos que se pierden. Lo medido arriba es
de un proyecto hermano. En `yacco-web` se vuelve a comprobar con `curl` sobre
su primer preview y su primera URL única de producción, antes de dar por
cerrada P-05.

**El hueco que esta decisión no tapa.** El día que se agregue un dominio
propio y nadie lo sume a `vercel.json`, ese dominio es público, cae en
"cualquier otro host" y sirve demo **sin que nada se vea raro**. Queda anotado
aparte en `backlog-tecnico.md`, «El fail-safe a demo es silencioso».

**Alternativas descartadas.**

- _Enumerar todos los hosts que sirven producción._ Las URLs únicas no se
  pueden enumerar (nace una por deploy) y su forma coincide con la de los
  previews. El alias del team y el de rama sí son enumerables, pero están
  detrás del login: sumarlos agrega dos formas de llegar a producción que no
  necesita nadie.
- _Sumar también el alias del team por ser estable._ Mismo motivo: nadie de la
  planta lo recibe, y cada literal de más en la lista de producción es una
  puerta más que hay que cuidar.

---

### D-012 — La forma exacta de `vercel.json`: `has.host` literal, `/health` por el mismo camino que `/api/*`, URLs de Cloud Run por defecto

**Contexto.** D-011 ya decidió QUÉ host cuenta como producción. Esto es CÓMO
queda escrito: la mecánica de `vercel.json` y las URLs concretas que
`/api/(.*)` y `/health` llevan detrás.

**Decisión — el orden y la forma de las reglas.**

```
1. host == "yacco-web.vercel.app" (has, literal, sin regex)
   /api/:path*          -> https://yacco-api-297699663114.us-east4.run.app/api/:path*
   /:witness(health)    -> https://yacco-api-297699663114.us-east4.run.app/:witness
2. cualquier otro host (sin condición `has`)
   /api/:path*          -> https://yacco-api-demo-297699663114.us-east4.run.app/api/:path*
   /:witness(health)    -> https://yacco-api-demo-297699663114.us-east4.run.app/:witness
3. todo lo demás
   /(.*)                -> /index.html   (fallback de React Router)
```

**Corrección de la fase 5: parámetros con nombre, no `(.*)` y `$1`.** La
primera versión de este archivo (PR #132) escribía `/api/(.*)` →
`.../api/$1`. Al construirlo con `vercel build` apareció que Vercel le AGREGA
al destino, como query string, cada parámetro de una condición `has` que el
destino no use — y `has: host` cuenta como parámetro `host` —, salvo que el
path del destino ya use algún parámetro CON NOMBRE. Con `$1` (sin nombre) cada
petición a producción llegaba a Cloud Run como
`/api/v1/customers?host=yacco-web.vercel.app`. La API corre el
`ValidationPipe` con `forbidNonWhitelisted`, así que todo endpoint con DTO de
query habría contestado 400 — **sólo en producción**, porque las reglas de demo
no tienen `has` —, y el smoke no lo habría visto: sin credenciales los guards
contestan 401 antes de validar la query. Se detectó antes del primer deploy
(nada llegó a servirse con esa forma). `/api/:path*` y `/:witness(health)`
usan un parámetro con nombre en el destino y el `?host=` desaparece:
verificado en el `.vercel/output/config.json` que genera `vercel build`.
`scripts/vercel-config.test.mjs` falla si alguna regla con `has` vuelve a la
forma anterior.

`vercel.json` también dice cómo se construye (`installCommand`,
`buildCommand`, `outputDirectory`): el build corre en CI y se sube ya hecho
(D-014), así que el proyecto de Vercel no depende de su propia configuración
de build ni de acceso al repositorio.

Vercel evalúa las reglas de `rewrites` en orden y aplica la primera cuyo
`source` y condición `has` coincidan, así que este orden — literal antes que
default, y las dos rutas ANTES del fallback de SPA — es lo que hace que la
regla 1 nunca quede tapada por la 2, y que ninguna de las dos quede tapada por
el catch-all de React Router. Los archivos estáticos del build (JS, CSS,
`index.html` mismo) los sirve Vercel por filesystem antes de mirar
`rewrites`, así que el catch-all no les pisa la respuesta.

**`/health` va con la MISMA condición de host que `/api/(.*)`, no una propia.**
Es la razón de ser de este archivo: `/health` es el testigo con el que se
verifica P-05 (ver `HealthService.appEnvironment`, PR #131), y un testigo que
viaja por una regla distinta prueba esa regla, no el rewrite que
efectivamente usa la SPA. Antes de esta rama, `/health` no tenía cómo
alcanzarse por `vercel.json`: está excluido del prefijo `api/v1`
(`configure-app.ts`), así que necesita su propia entrada además de la de
`/api/(.*)`.

**Las URLs de Cloud Run, y por qué son el formato `SERVICE-PROJECT_NUMBER.REGION.run.app`
y no el otro.** Cloud Run le da a cada servicio dos URLs válidas y
equivalentes: una con hash (`yacco-api-demo-rngajdr5pa-uk.a.run.app`, la que
imprime `pnpm deploy:api` porque es el `status.url` que informa
`gcloud run services describe`) y otra con el número de proyecto
(`yacco-api-demo-297699663114.us-east4.run.app`). Verificado con `curl`
2026-09-16: las dos responden lo mismo para `yacco-api-demo`. La segunda es
la que usa `vercel.json`, porque es **determinística antes de que el
servicio exista** — depende solo del nombre del servicio, el número de
proyecto (`297699663114`, fijo, ver fase 2) y la región (`us-east4`, D-002) —
mientras que el hash de la primera lo asigna Cloud Run al crear el servicio y
no se puede predecir.

Eso importa hoy mismo: `yacco-api` (producción) **todavía no está desplegado**
— sólo `yacco-api-demo` (fase 3). `https://yacco-api-297699663114.us-east4.run.app`
es la URL que va a tener en cuanto se corra `pnpm deploy:api --env=production`
por primera vez, sin esperar a que exista para escribirla. Hasta que ese
deploy pase, esa regla del rewrite devuelve error — nunca cae en demo por
accidente, porque la condición de host la separa de la regla 2 — y es la
verificación pendiente que anota P-05 más abajo.

**Alternativa descartada.** _Usar variables de entorno de Vercel
(`$API_ORIGIN` por Environment) en vez de `has.host`._ Era la forma que
imaginaba P-02 antes de que D-011 fijara la regla en host y no en
Environment de Vercel (Production/Preview): un preview y la URL única de un
deploy de producción son los dos "Preview" para Vercel, así que un rewrite
por Environment no los distingue — es exactamente el problema que D-011
resolvió mirando el host en cambio.

---

### D-013 — `WEB_ORIGIN` cierra P-02: el alias estable de Vercel en producción, sólo el dev local en demo

**Contexto.** Esta rama deja `VITE_API_BASE_URL` relativo
(`apps/web/src/config.ts`): bajo el rewrite, la SPA nunca vuelve a hacer una
petición cross-origin a Cloud Run en el camino normal, porque toda llamada
va a su propio origen y es Vercel quien reenvía por detrás. Eso confirma lo
que P-02 ya sospechaba — `WEB_ORIGIN` no interviene ahí —, y falta decidir
qué valor lleva cada servicio.

**Decisión.**

- `yacco-api` (producción): `WEB_ORIGIN=https://yacco-web.vercel.app,http://localhost:5173`
  — el alias estable (D-011) más el dev local de siempre.
- `yacco-api-demo`: `WEB_ORIGIN=http://localhost:5173`, sin cambios respecto
  de hoy.

**Por qué demo no suma nada de Vercel.** Sus llamadores reales son los
previews, y cada uno nace con una URL única (D-011): no hay nada fijo que
enumerar. El alias del team o el de rama tampoco sirven — mismo argumento de
D-011: nadie de la planta los usa, y sumarlos sería agrandar la lista de
orígenes confiables sin motivo.

**Por qué sigue sin ser `*`.** `WEB_ORIGIN` es la última barrera contra
alguien que apunte un navegador directo a la URL pública de Cloud Run con
`credentials: true`. El camino normal ya no la necesita (párrafo anterior),
pero el caso raro que sigue necesitándola es justo al que hay que seguirle
pidiendo un origen conocido — abrirlo a cualquiera no gana nada y pierde esa
barrera.

**Cierra P-02.**

**Cómo viaja la coma hasta Cloud Run (2026-09-16).** El `WEB_ORIGIN` de
producción es una lista con coma, y `gcloud run deploy --set-env-vars` usa la
coma para separar variables. Así escrito, gcloud leía `http://localhost:5173`
como una variable sin `=` y rechazaba el comando: pasó en el segundo deploy
desde CI, en «4b · Cloud Run producción», antes de crear el servicio, y no en
demo, cuyo valor no tiene coma. `scripts/deploy-api.mjs` arma los flags de
diccionario con el separador alternativo de `gcloud topic escaping` (`^@@^`) y
frena si algún valor contiene ese separador. `scripts/deploy-api.test.mjs`
parsea el flag como gcloud y exige que `WEB_ORIGIN` llegue entero.

---

### D-014 — El deploy corre en CI, en un orden fijo, construyendo una sola imagen

**Contexto.** Hasta la fase 4, `pnpm deploy:api` corría `docker build` y
`docker push` en la máquina de quien desplegaba. Con el Docker del dueño caído,
eso dejó sin forma de desplegar nada, y convirtió una laptop en dependencia del
camino a producción.

**Decisión.** `.github/workflows/deploy.yml`, disparado cuando CI termina bien
sobre `main` y después de esperar a que CodeQL también pase para ese commit.
Los checks existentes no cambian: el gate de SonarCloud sigue en 80% de código
nuevo y 3% de duplicación. El orden de los jobs es el diseño:

```
gate → preflight → 1 integración → 2 migraciones (demo, después main)
     → 3 imagen → 4a Cloud Run demo → (si queda sana) 4b producción
     → 5 web a Vercel → 6 smoke de solo lectura
```

Qué queda en pie cuando cada paso falla está escrito job por job en el propio
workflow. El caso que más importa: **si las migraciones pasan y la imagen
falla, la base quedó migrada y el código viejo sigue sirviendo.** Ese estado no
se evita, se banca: es exactamente por qué las migraciones son
expand/contract, y la frase está escrita en el job, no sólo acá.

Lo que sostiene ese orden:

- **Una sola imagen.** `scripts/deploy-api.mjs` se partió en `build` y
  `deploy`, y CI usa esas dos mitades: construye UNA vez y despliega a demo y a
  producción la MISMA imagen, identificada por el sha. No hay un segundo camino
  de build (ni `gcloud run deploy --source` ni buildpacks): el Dockerfile y el
  script son los mismos que se corren a mano. `deploy` se niega a desplegar
  una imagen con el commit de otra: la única etiqueta de una imagen es su sha.
- **Sin etiqueta de entorno (`:demo`, `:production`), y no se repone.** El
  diseño original, además del sha, movía una etiqueta con el nombre del entorno
  "para ver de un vistazo qué está desplegado". Se eliminó el 2026-09-16,
  después de que el primer deploy desde CI fallara justo ahí, en «4a · Cloud Run
  demo», antes de tocar el servicio. Por tres razones, y cualquiera alcanzaba:
  1. **No se usaba para desplegar.** Nada despliega por esa etiqueta: se
     despliega siempre la imagen del sha (`assertImageMatchesCommit`).
  2. **Requería un permiso que el deployer no tiene por diseño.** Mover una
     etiqueta existente exige `artifactregistry.tags.delete`, que
     `artifactregistry.writer` no incluye. Darlo implicaba un rol a medida o
     `repoAdmin`, que además permite borrar imágenes: ampliar los permisos del
     que despliega para sostener un dato que nadie consulta.
  3. **Quedaba desactualizada, o sea que mentía.** El día que se sacó, `:demo`
     apuntaba a `f66c8c775dac`, una imagen de la fase 3 que no era la que iba a
     correr. Un puntero decorativo y desactualizado es peor que ninguno:
     alguien lo lee algún día creyendo que dice qué está desplegado.

  **Qué está desplegado lo dicen el `commit` de `/health` y la revisión activa
  de Cloud Run** (`gcloud run revisions list --service=…`). Si alguna vez hace
  falta "más visibilidad", tiene que salir de ahí y no de una etiqueta.
  `scripts/deploy-api.test.mjs` falla si un comando del deploy vuelve a tocar
  etiquetas. Las etiquetas viejas `:demo` y `f66c8c775dac` quedan en Artifact
  Registry sin efecto; la `:demo` la borra el dueño (ver `PROGRESO.md`).

- **"Sana" es verificable.** Después de cada deploy de Cloud Run,
  `scripts/smoke.mjs api --env=…` exige `/health` con el commit recién
  construido y el `environment` correcto, más un login inexistente rechazado
  con 401. Producción no se toca si demo no pasa.
- **Preflight antes de migrar.** Un secreto ausente (el token de Vercel, por
  ejemplo) se descubre antes de tocar ninguna base, no en el paso 5 con todo
  lo anterior ya hecho.
- **Sólo la punta de `main`.** Si `main` avanzó mientras CI corría, ese commit
  no se despliega: lo hace la corrida del commit nuevo. Sin esto, dos merges
  cuyos CI terminan en otro orden podrían desplegar el viejo después del
  nuevo. Un solo deploy a la vez, y nunca se cancela uno en curso.

**Credenciales.** Todo por Workload Identity Federation: los secretos de GitHub
no guardan ninguna llave. Lo que CI necesita leer —la URL directa de Neon de
cada rama, para migrar, y el token de Vercel (D-015)— sale de Secret Manager en
el job que lo usa, y el deployer tiene `secretAccessor` sobre esos tres
secretos uno por uno, no sobre el proyecto. Nunca sobre las URLs pooled ni los
JWT, que son del runtime.

Con ese acceso nuevo, el proveedor de WIF quedó anclado también a la rama:
`assertion.ref == 'refs/heads/main'`, además del repositorio. Anclado sólo al
repositorio, un workflow agregado en una rama sin mergear podía pedir las
credenciales de Neon. Aplicado con `pnpm gcp:bootstrap` el 2026-09-16.

**Las migraciones de `main` le cambian el esquema a Render.** Mientras Render
siga vivo (fase 7), comparte la rama `main`. Si su build corre `db:deploy` a la
vez que CI, Prisma serializa las dos con un advisory lock.

**Alternativas descartadas.**

- _Pasos dentro de `ci.yml`._ Un solo archivo, pero mezcla lo que corre en cada
  PR con lo que sólo corre en `main` y con credenciales de producción, y
  agranda la superficie que tiene `id-token: write`.
- _`gcloud run deploy --source` (Cloud Build)._ Evita el Docker del runner,
  pero es un segundo camino de build que produce una imagen distinta de la que
  se construye a mano, con otra caché y otros defaults.
- _Guardar `DIRECT_URL` como secreto de GitHub, como decía ENTORNOS.md._ Es una
  credencial de larga vida con la contraseña de la base adentro, justo lo que
  la fase 2 sacó de GitHub.
- _No correr integración en el deploy porque CI ya la corrió._ Es la compuerta
  inmediata antes de tocar una base real, sobre exactamente el commit que se
  va a desplegar. Cuesta minutos de runner; no correrla cuesta suponer.

---

### D-015 — El token de Vercel vive en Secret Manager, no en los secretos de GitHub

**Contexto.** Vercel no acepta Workload Identity de GitHub para desplegar: hace
falta un token. La regla de la fase 2 es que los secretos de GitHub no guardan
ninguna llave de larga vida, y el diagrama original lo contradecía
(`GitHub Actions ──VERCEL_TOKEN──▶ Vercel`).

**Decisión.** El dueño crea el token en Vercel y lo pone en `.env.setup`;
`pnpm secrets:gcp --upload=VERCEL_TOKEN` lo sube a Secret Manager como
`yacco-ci-vercel-token` sin imprimirlo y le da lectura al deployer. Sin
`--upload`, el script no sube nada que venga de `.env.setup` (D-007). CI entra a Google Cloud por WIF y lo lee
en el momento, sólo en el job que publica el web. La CLI de Vercel lo recibe
por la variable `VERCEL_TOKEN`, nunca por `--token`.

**Vencimiento: el token se crea con 30 días. Creado el 2026-09-16, vence el
2026-10-16.** Si se creó otro día, corregir las dos fechas acá y en
`PROGRESO.md`. Al rotarlo: token nuevo en `.env.setup`,
`pnpm secrets:gcp --upload=VERCEL_TOKEN` y fecha nueva en los dos lugares.

**Cuando vence, el deploy NO falla en el preflight: falla en el paso 5.** El
preflight sólo comprueba que el secreto exista y tenga valor, y un token vencido
existe y tiene valor. Así que un deploy con el token vencido **migra las dos
bases y despliega las dos APIs** y recién ahí falla, en el job «5 · Web a
Vercel», en el primer comando de la CLI (`vercel pull`), con un error de
autenticación de Vercel. Queda el estado de esa fila en la tabla de
`DEPLOY.md`: las APIs en el código nuevo y el web en el anterior. Nada roto,
pero el web desactualizado. Si el paso 5 falla con un error de token o de
autenticación, **lo primero es mirar esta fecha**, antes de depurar nada más.

**El preflight comprueba PRESENCIA, no validez, y eso vale para TODOS los
secretos que lee**, no sólo para el token. Una credencial de Neon rotada
(contraseña cambiada, rol borrado) también pasa el preflight, y falla recién en
«2 · Migraciones», al conectar. Falla antes que el token, así que no deja APIs
desplegadas, pero tampoco la frenó el preflight. Que nadie lea un preflight en
verde como garantía de que los secretos sirven: garantiza que existen y tienen
valor, nada más.

Que el preflight detecte un token vencido exige validarlo contra Vercel con
`vercel whoami`, que no escribe nada, y no sólo mirar que no esté vacío. Es un
cambio del workflow: anotado en `backlog-tecnico.md`, «El preflight no valida
el token de Vercel», con fecha límite antes de la fase 7.

**Lo que esto NO cambia: el token SIGUE siendo de larga vida.** Lo que cambia
es que vive en un solo lugar, con acceso auditado, y que un compromiso de los
secretos de GitHub ya no alcanza a Vercel: para leerlo hay que pasar por WIF,
que exige este repositorio y la rama `main`. **Se rota al cerrar la
migración**, junto con los otros tres (`GH_TOKEN`, `NEON_API_KEY`,
`RENDER_API_KEY`) — ver PROGRESO.md.

"Auditado", con precisión: QUIÉN puede leerlo está en la política IAM del
propio secreto, y cada cambio de esa política queda en los Admin Activity logs,
que están siempre prendidos. Cada LECTURA del valor queda registrada sólo si se
prenden los Data Access logs de Secret Manager, que en Google Cloud vienen
**apagados** por defecto. Hoy no están prendidos: queda anotado para el auditor
de seguridad de la fase 6.

#### Cómo se prenden los Data Access logs de Secret Manager _(escrito, NO aplicado)_

**Qué registra cada tipo**, según la documentación de Secret Manager:

| Tipo de log                    | Métodos                                                              | Estado por defecto |
| ------------------------------ | -------------------------------------------------------------------- | ------------------ |
| `DATA_READ` (Data Access)      | `AccessSecretVersion`: leer el VALOR                                 | apagado            |
| `ADMIN_READ` (Data Access)     | `GetSecret`, `GetSecretVersion`, `ListSecrets`, `ListSecretVersions` | apagado            |
| Admin Activity (`ADMIN_WRITE`) | `AddSecretVersion`, `SetIamPolicy`                                   | siempre prendido   |

Se prenden `DATA_READ` y `ADMIN_READ`. `DATA_WRITE` no aplica: Secret Manager no
tiene métodos de ese tipo.

**Estado medido el 2026-09-16:** la política IAM del proyecto no tiene ningún
`auditConfigs` (`version: 1`), y el bucket `_Default`, donde caen estos logs,
retiene **30 días**.

**El procedimiento.** No hay un `gcloud` de un solo paso: se edita la política
IAM del PROYECTO entero, así que se hace a mano, con cuidado, y se verifica.

```bash
# 1. Leer la política actual a un archivo.
gcloud projects get-iam-policy yacco-v2-prod --format=yaml > policy.yaml
```

```yaml
# 2. Agregarle ESTE bloque al principio de policy.yaml. No tocar `bindings:` ni
#    `etag:`: se quedan exactamente como vinieron.
auditConfigs:
  - service: secretmanager.googleapis.com
    auditLogConfigs:
      - logType: DATA_READ
      - logType: ADMIN_READ
```

```bash
# 3. Escribir la política.
gcloud projects set-iam-policy yacco-v2-prod policy.yaml

# 4. Verificar que quedó el auditConfigs Y que los bindings siguen ahí.
gcloud projects get-iam-policy yacco-v2-prod --format="yaml(auditConfigs)"
gcloud projects get-iam-policy yacco-v2-prod \
  --flatten="bindings[].members" --format="table(bindings.role,bindings.members)"
```

Lo peligroso de este procedimiento no es el bloque que se agrega, sino lo que se
puede perder al escribir la política:

- **`set-iam-policy` REEMPLAZA la política entera.** Si `policy.yaml` pierde la
  sección `bindings:`, todos los principals pierden el acceso al proyecto: el
  dueño, el deployer de CI y la identidad de runtime de Cloud Run. Por eso el
  paso 4 lista los bindings.
- **El `etag` es la protección contra cambios concurrentes.** Si otra cosa
  cambió la política entre el paso 1 y el 3 —por ejemplo `pnpm gcp:bootstrap`
  corriendo en otra terminal, que concede roles de proyecto; `secrets:gcp` no,
  porque cambia la política de cada secreto y no la del proyecto—, el paso 3
  falla por conflicto y NO pisa nada. Se repite desde el paso 1; nunca se borra el
  `etag` para forzarlo.
- **`policy.yaml` no se commitea**: lista todos los miembros del proyecto.

**Costo.** Google avisa que estos logs pueden cobrarse. Acá el volumen es
mínimo. Leen secretos Cloud Run, cuatro por cada instancia que arranca;
`pnpm secrets:gcp`, cada secreto al compararlo; y CI, hasta cinco por deploy.
Son decenas de entradas por día, contra una cuota gratuita de Cloud Logging
que se mide en GiB por mes.

**Recomendación: prenderlos ANTES del primer uso real del token.** El orden
queda así:

1. Prender los logs (este procedimiento).
2. `pnpm secrets:gcp --upload=VERCEL_TOKEN`, que sube el token. Ya lee
   secretos para comparar, y esas lecturas quedan registradas.
3. Relanzar el deploy.

Por qué:

- **Sin hueco de arranque.** Prenderlos después dejaría sin registro justo las
  primeras lecturas, que son las que no tienen con qué compararse.
- **Costo y riesgo operativo prácticamente nulos.** El único riesgo real es
  escribir mal la política, y lo cubren el `etag` y la verificación del paso 4.
- **Queda la línea de base.** Cloud Run y CI leen secretos de forma regular;
  una lectura con otra identidad o en otro horario se ve contra ese patrón.

**Límite que queda después de prenderlos:** 30 días de retención en `_Default`.
Guardarlos más tiempo es otra decisión: un bucket de logs con retención propia
y un sink que filtre `protoPayload.serviceName="secretmanager.googleapis.com"`.

**Alternativa descartada.** _Secreto de GitHub._ Más simple, y exactamente una
llave de larga vida en los secretos de GitHub.

---

## Preguntas abiertas de infraestructura

Se cierran en la fase que indica cada una, y al cerrarse se convierten en una
decisión `D-nnn` acá arriba. Cada una lleva la recomendación de hoy, para que
cerrarla sea confirmar o contradecir, no empezar de cero.

### P-05 — ¿Cómo se apunta un preview de Vercel a la API de demo? _(se cierra en la fase 4)_

> P-02 (`WEB_ORIGIN` después del rewrite) cerró como D-013.

Un preview que pegue a la API de producción escribe en la base de producción.

**Estado:** la forma ya está decidida y escrita. El rewrite elige destino por
host — D-011 dice qué host cuenta como producción, D-012 dice la forma exacta
de `vercel.json` — y `/health` viaja por la misma regla que `/api/*`, así que
es un testigo válido de qué servicio contestó (ver PR #131,
`HealthService.appEnvironment`).

**Falta para cerrarla.** Los pasos reproducibles están en `DEPLOY.md`, sección
«Verificar P-05». Desde la fase 5 ya no dependen de Docker en ninguna máquina:
el deploy corre en CI (D-014).

- **La mitad de producción quedó automatizada.** `pnpm smoke:prod`, el último
  paso del deploy desde CI, pide `/health` a `yacco-web.vercel.app` y FALLA si
  no contesta `environment: "production"` — o si contesta `null`.
- **La mitad del preview sigue siendo manual**, porque los previews están
  detrás del login de Vercel (D-011) y CI no publica previews. Se corre una vez,
  después del primer deploy desde CI, con `pnpm deploy:web --preview` y
  `vercel curl`.

Si cualquiera de los dos contesta `environment: null`, PARAR — significa que
ese servicio quedó sin `APP_ENV` y el testigo no sirve hasta que se arregle.
