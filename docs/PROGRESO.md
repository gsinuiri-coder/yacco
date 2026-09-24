# Progreso de la migración a Cloud Run + Vercel

Bitácora de la migración, por fase. Se actualiza al cerrar cada sesión de
trabajo. El _por qué_ de cada decisión está en
[`ARQUITECTURA.md`](./ARQUITECTURA.md); acá está sólo qué quedó hecho y qué
falta.

**Objetivo, en orden de importancia:** (1) llevar la API de Render a Google
Cloud Run; (2) llevar el web a Vercel. Todo lo demás del stack se mantiene. La
app funciona al cerrar cada fase.

## Estado por fase

| Fase                    | Estado   |
| ----------------------- | -------- |
| 0 — Descubrimiento      | ✅ hecha |
| 1 — Base del repo       | ✅ hecha |
| 2 — Google Cloud        | ✅ hecha |
| 3 — La API en Cloud Run | ✅ hecha |
| 4 — El web en Vercel    | ✅ hecha |
| 5 — CI/CD               | ✅ hecha |
| 6 — Ensayo              | ✅ hecha |
| 7 — Corte               | ✅ hecha |

## Punto de partida verificado

Medido al empezar, para poder comparar después:

- **Render** responde: `GET https://yacco-api.onrender.com/health` →
  `{"status":"ok","commit":"bfcb6d51ac74f61d62788efca6abbbe3e5a72ef8"}`, que es
  el tip de `main`. La primera respuesta tras un rato ocioso tardó **5,4 s**
  (plan free: el servicio se suspende). Esa cifra es el listón que Cloud Run
  tiene que mejorar.
- **Arranque en frío de la API**, medido contra un Postgres local, desde que se
  lanza el proceso hasta que `/health` contesta 200, cinco corridas: mediana
  **4.025 ms** (min 3.800, max 4.099). Son cuatro segundos con la base al lado
  y sin arranque de contenedor. Es el dato que sostiene la recomendación de
  `--min-instances=1` en P-01, que se cierra midiendo lo mismo en Cloud Run.
- **Neon**: proyecto `yacco-production` (`late-union-50177487`) en
  `aws-us-east-1`. **Una sola rama, `main`.** No existe todavía la rama `demo`
  que la migración necesita (P-04).
- **GCP**: existe `yacco-2026`, que es el Yacco viejo sobre Firebase/Firestore.
  No se toca (D-001).
- **GitHub**: repo `gsinuiri-coder/yacco`, público, rama por defecto `main`. Un
  solo secreto configurado: `SONAR_TOKEN`.
- **CI hoy**: `ci.yml` (lint, formato, typecheck, prisma validate, chequeo de
  drift de migraciones, build, tests unitarios, tests de integración con
  Testcontainers, audit, SonarCloud) y `codeql.yml`. No hay ningún paso de
  despliegue: hoy despliega Render por su cuenta.

## Fase 0 — Descubrimiento ✅

Leído el repo: `schema.prisma`, los 21 módulos de la API, `render.yaml`,
`docker-compose.yml`, los dos workflows, `sonar-project.properties`, el hook de
Husky y los scripts de cada `package.json`.

Escritos `ARQUITECTURA.md` (registro de decisiones, arquitectura objetivo,
preguntas abiertas), `ENTORNOS.md`, `DEPLOY.md` y este archivo.

**Decisiones registradas:** D-001 (proyecto GCP nuevo), D-002 (región
`us-east4`), D-003 (lanzar los CLI sin shell), D-004 (configuración efectiva),
D-005 (las reglas de infra van en archivo aparte).

**Preguntas abiertas:** P-01 a P-05, cada una con su recomendación y la fase en
la que se cierra.

### Hallazgos que corrigen supuestos del plan

Tres cosas resultaron distintas de como estaban enunciadas al arrancar. Quedan
acá anotadas porque cambian el trabajo:

1. **`/health` NO verifica la base de datos**, y eso es deliberado.
   `apps/api/src/modules/health/health.controller.ts` lo dice con todas las
   letras: el health check no debe tocar la base, porque un pooler de Neon frío
   haría fallar la sonda de liveness en vez de simplemente responder lento. La
   verificación de base vive en `/health/db`, que es un diagnóstico manual y no
   está conectado a ninguna sonda. El health check de Cloud Run apunta a
   `/health`, igual que el de Render.
2. **`.env.setup` ya existía, con las claves de otro plan** (R2, Nubefact,
   UptimeRobot, un único `JWT_SECRET`) y casi todas vacías. No tenía ninguna de
   las claves que esta migración necesita. No se borró nada: la plantilla nueva
   `.env.setup.example` declara sólo las claves de la migración, y `env:check`
   evalúa sólo esas.
3. **`.env.setup.example` estaba condenado a quedar ignorado.** `.gitignore`
   tenía `.env.*` con una única excepción, `!.env.example`, que es un nombre
   exacto y no un prefijo. Sin una excepción propia, la plantilla se habría
   commiteado "en silencio" sin llegar nunca al repo. Corregido.

## Fase 1 — Base del repo ✅

- `scripts/lib.mjs`: `readEnvFile` (el único lector de `.env.setup`),
  `loadConfig` (archivo + entorno), `run` (lanza CLIs sin shell, credenciales
  por `env` y nunca por argv, errores sin argumentos, `quiet` para los comandos
  que imprimen credenciales al salir bien) y un tachado de secretos **por
  valor**, que sobrevive a que un secreto aparezca interpolado en un mensaje
  ajeno.
- `scripts/env-keys.mjs`: el contrato de `.env.setup` en un solo lugar, para
  que una clave nueva no quede validada en un script y olvidada en otro.
- `.env.setup.example` + `pnpm env:check`: lista qué falta **sin imprimir
  ningún valor**.
- `pnpm secrets:generate`: genera `JWT_ACCESS_SECRET` y `JWT_REFRESH_SECRET`
  (48 bytes aleatorios) y los escribe en `.env.setup` sin imprimirlos. No pisa
  un valor existente salvo con `--force`.
- `pnpm env:local`: escribe los `.env` de cada app apuntando al Postgres de
  Docker, averiguando el puerto real en vez de asumirlo.
- `.claude/settings.json`: agregados `allow` para `gcloud`, `vercel`, `neonctl`
  y `gh`, y `deny` para `neonctl branches delete*` y `gcloud projects delete*`.
  **Los dos hooks existentes quedaron intactos.**
- `.claude/agents/auditor-seguridad.md`: subagente de solo lectura (IAM, WIF,
  secretos, CORS, superficie expuesta, headers, dependencias). Corre en la fase
  6, obligatorio, antes del corte.
- `.gitignore`: excepción para `.env.setup.example` y regla para
  `.claude/worktrees/`.

## Fase 2 — Google Cloud ✅

Todo por `pnpm gcp:bootstrap` y `pnpm secrets:gcp`, los dos idempotentes y
corridos dos veces para comprobarlo.

| Recurso           | Valor                                                     |
| ----------------- | --------------------------------------------------------- |
| Proyecto          | `yacco-v2-prod` (número 297699663114)                     |
| Facturación       | `0148EC-33BCAA-9A4CED` ("pago firebase 02")               |
| Región            | `us-east4`                                                |
| Artifact Registry | `yacco`, formato docker                                   |
| SA de runtime     | `yacco-api-run`, sólo `secretmanager.secretAccessor`      |
| SA de despliegue  | `yacco-deployer`, `run.admin` + `artifactregistry.writer` |
| WIF               | pool `github`, proveedor `github-oidc`                    |
| Rama Neon demo    | `demo` (`br-dawn-field-autu1p5w`), hija de `main`         |

Ocho secretos en Secret Manager, cuatro por entorno (`database-url` pooled,
`direct-url` directa, `jwt-access-secret`, `jwt-refresh-secret`). Ninguno se
imprimió: los valores viajan a `gcloud` por **stdin**, y las connection strings
se piden a `neonctl` con `quiet: true` porque ese comando imprime la credencial
al salir bien.

**Sin ninguna llave de service account.** GitHub Actions entra por Workload
Identity Federation, y la condición del proveedor lo ancla a este repositorio:
`assertion.repository == 'gsinuiri-coder/yacco'`. Un proveedor sin esa
condición dejaría que el workflow de cualquier repo de GitHub pidiera tokens
contra el proyecto, porque el emisor es el mismo para todo GitHub.

Para los secretos del repositorio, cuando llegue la fase 5 (ninguno de los dos
es secreto: identifican recursos, no autorizan nada por sí solos):

```
GCP_WORKLOAD_IDENTITY_PROVIDER = projects/297699663114/locations/global/workloadIdentityPools/github/providers/github-oidc
GCP_DEPLOYER_SERVICE_ACCOUNT   = yacco-deployer@yacco-v2-prod.iam.gserviceaccount.com
```

### Dos tropiezos, por si vuelven a aparecer

1. **`yacco-v2` ya estaba tomado.** Los IDs de proyecto de GCP son únicos en el
   mundo, no por cuenta. De ahí `yacco-v2-prod`.
2. **Artifact Registry falló con `PERMISSION_DENIED` la primera vez**, siendo
   Owner del proyecto: propagación de IAM después de habilitar la API. El
   reintento funcionó, que es exactamente para lo que el script es idempotente.

### Para el auditor de seguridad de la fase 6

El proyecto nuevo trae de fábrica la service account por defecto de Compute
Engine (`297699663114-compute@developer.gserviceaccount.com`) con
**`roles/editor` sobre todo el proyecto**. No la usamos —Cloud Run corre con
`yacco-api-run`— pero existe, y es lo primero que un auditor debería mirar.

## Fase 3 — La API en Cloud Run ✅

**Desplegada y verificada contra la rama `demo` de Neon.** El tráfico real
sigue íntegro en Render: nada de esto lo toca.

```
https://yacco-api-demo-rngajdr5pa-uk.a.run.app/health      200
https://yacco-api-demo-rngajdr5pa-uk.a.run.app/health/db   200
```

Ese `/health/db` en 200 es lo que valida la cadena entera de una vez: imagen en
Artifact Registry, service account propia, secretos montados por referencia
desde Secret Manager, y la URL pooled contra la rama correcta.

### El Dockerfile

Multi-stage, construido desde la raíz del monorepo. Tres cosas que costaron
encontrarlas y por eso están comentadas en el archivo:

1. **`pnpm deploy --prod` reinstala `node_modules` desde el store**, así que el
   cliente de Prisma generado en el build NO viaja. Hay que regenerarlo dentro
   de `/app`.
2. **El binario de `prisma` vive en `apps/api/node_modules/.bin`**, no en la
   raíz: pnpm enlaza los ejecutables en el paquete que declara la dependencia.
3. **`--legacy` no existe** en `pnpm deploy` en pnpm 9.15.

Usuario no root (`node`, uid 1000) y `node` como PID 1 sin shell, para que el
SIGTERM de Cloud Run llegue al proceso y dispare el `enableShutdownHooks` que
cierra el pool de Prisma.

### Tamaño de imagen: 603 → 541 MB

Desmontada, la imagen tenía 95 MB de `@prisma/client` + 36 MB de
`@prisma/engines` con los motores de **cockroachdb, mysql, sqlite y
sqlserver** —este proyecto sólo habla postgresql— y 23 MB de **TypeScript**,
que `pnpm deploy --prod` arrastra por ser peer opcional de `@prisma/client`:
un compilador dentro de una imagen que sólo ejecuta JavaScript ya compilado.

Los motores se borran **por nombre de motor**, nunca con un comodín sobre
`query_engine`: eso se llevaría también el de postgresql y el cliente dejaría
de funcionar en runtime, no en el build. Verificado corriendo la imagen
delgada: `/health/db` sigue en 200.

### Tres cambios de código, todos de configuración

- `/health` publica el commit desplegado (D-009).
- Swagger con gate, apagado por defecto (D-010).
- `env.validation.ts` declara las dos variables nuevas.

**Decisiones registradas:** D-008 (`--min-instances`), D-009 (commit
desplegado), D-010 (Swagger). Cierran P-01 y P-03.

## Fase 4 — El web en Vercel 🟨

Proyecto `yacco-web` creado en el team `gsinuiricoders-projects`, dominio de
producción `yacco-web.vercel.app`. `vercel.json` con las reglas de host (D-011,
D-012), `VITE_API_BASE_URL` relativo y `WEB_ORIGIN` por entorno (D-013). PRs
#131 y #132. Todavía no hay ningún deploy: el primero lo hace CI.

## Fase 5 — CI/CD 🟨

`.github/workflows/deploy.yml` (D-014): después de CI y CodeQL sobre `main`,
integración → migraciones → una imagen → Cloud Run demo → producción → web →
smoke de solo lectura. El token de Vercel en Secret Manager (D-015).

Aplicado en Google Cloud el 2026-09-16, con `pnpm gcp:bootstrap` y
`pnpm secrets:gcp`, sin rotar nada:

- El proveedor de WIF exige ahora repo **y** rama `main`.
- El deployer lee `yacco-demo-direct-url` y `yacco-production-direct-url`, uno
  por uno. Nada más.

Encontrado al construir el web por primera vez: las reglas de #132 con
`(.*)` y `$1` hacían que Vercel le agregara `?host=` a cada petición a
producción, y la API la habría rechazado con 400. Corregido antes de ningún
deploy (D-012).

## Primer deploy desde CI — 2026-09-16

Tres corridas, todas sin cambiar el esquema de ninguna base («No pending
migrations to apply» en `main` y `demo` las tres veces).

| Corrida                         | Commit        | Resultado                                                                                | Causa y arreglo                                                                                                                           |
| ------------------------------- | ------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 35119690429 (manual)            | `3275c7e`     | falló en «4a · Cloud Run demo», antes de tocar el servicio                               | Mover la etiqueta `:demo` exige `artifactregistry.tags.delete`, que el deployer no tiene. Se eliminó la etiqueta de entorno (#135, D-014) |
| 35122780661 (merge de #135)     | `fd38b28`     | demo desplegada y sana; falló en «4b · Cloud Run producción», antes de crear el servicio | La coma de `WEB_ORIGIN` partía `--set-env-vars`. Separador alternativo `^@@^` y test que parsea como gcloud (#136, D-013)                 |
| **35134745175** (merge de #136) | **`645463c`** | **verde de punta a punta**                                                               | —                                                                                                                                         |

Verificado después de la corrida verde:

```
curl https://yacco-web.vercel.app/health
{"status":"ok","commit":"645463cb7c70b7b1de756c7cf4b267c9abe8c435","environment":"production"}
```

La mitad de producción de P-05 quedó verificada: el dominio de producción de
Vercel llega a `yacco-api`. `yacco-api` (producción) quedó creado en Cloud Run
por primera vez. **Render sigue sirviendo a los usuarios**: el corte es la fase 7.

**Pendiente de esta etapa:**

- La mitad del preview de P-05, a mano (ver `DEPLOY.md`).
- Evaluar si `http://localhost:5173` debe seguir en el `WEB_ORIGIN` de
  producción (PR propio, con recomendación antes de cambiar nada).
- ✅ Validar el token de Vercel en el preflight, antes de la fase 7.

## Fase 6 — Ensayo y auditoría ✅

Nada de esta fase tocó producción: el recorrido escribe sólo en demo, y la
auditoría fue de solo lectura.

### CI en verde de punta a punta: cinco corridas seguidas

| Corrida     | Commit    | Qué traía                                                  |
| ----------- | --------- | ---------------------------------------------------------- |
| 35134745175 | `645463c` | #136 — separador de flags de gcloud (primer verde)         |
| 35137518395 | `768404b` | #134 — docs, audit logs, `secrets:gcp` con lista explícita |
| 35142539369 | `0811f6d` | #137 — producción sin `localhost:5173` en `WEB_ORIGIN`     |
| 35150427631 | `80aef3e` | #138 — la API no arranca en producción sin `WEB_ORIGIN`    |
| 35153242446 | `f17c53b` | #139 — el preflight valida el token de Vercel              |

Las cinco pasaron los nueve jobs. Ninguna cambió el esquema de las bases.

### Ensayo

- **`pnpm smoke:prod`** — 2026-09-16 21:50 UTC, con `EXPECTED_COMMIT=f17c53b`:
  `Smoke OK.`
- **P-05, la mitad del preview — CERRADA con evidencia.** Preview publicado
  con `pnpm deploy:web --preview` (`yacco-c33znr9e8-gsinuiricoders-projects.vercel.app`):

  | Host                                                   | Sin sesión                 | Con `vercel curl`                                          |
  | ------------------------------------------------------ | -------------------------- | ---------------------------------------------------------- |
  | preview `yacco-c33znr9e8-…`                            | 302 a `vercel.com/sso-api` | `{"status":"ok","commit":"f17c53b…","environment":"demo"}` |
  | URL única del deploy de PRODUCCIÓN `yacco-jff4s9u6e-…` | 302 a `vercel.com/sso-api` | `"environment":"demo"` (D-011)                             |
  | `yacco-web.vercel.app`                                 | público                    | `"environment":"production"`                               |

- **Recorrido de la app contra demo — HECHO, por la API, 2026-09-17 ~04:10
  UTC.** Antes de darlo por hecho se miró la base: la rama `demo` no tenía
  **ninguna** escritura desde su creación (ni pedidos, rutas, paradas, ventas,
  pagos ni liquidaciones), y `main` tampoco desde el 2026-09-15. Un recorrido
  que registra paradas y cobranzas deja filas, así que no había evidencia de
  uno de escritura. Se hizo contra `yacco-api-demo` (con `/health` =
  `"demo"` comprobado antes del primer POST), con el mismo camino HTTP que usa
  el web:

  | Paso                                                | Qué se vio                                                                                                                  |
  | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
  | `pnpm demo:data` (copia con el catálogo real)       | parque inicial (80 vacíos), chofer `chofer.demo`, 8 clientes `(Demo)` y lote `LOTE-DEMO-01`                                 |
  | …su primera carga de ruta                           | **rechazada por FIFO**: «Primero hay que cargar el lote "L-230826"», el lote heredado de `main`. La invariante, funcionando |
  | Ruta del 2026-09-16, carga de 6                     | tomó las 6 de `L-230826` (2026-08-23), no del lote nuevo                                                                    |
  | 2 paradas de venta en camión, iniciar               | OK                                                                                                                          |
  | Parada A: 2 recargas + 2 vacíos devueltos, efectivo | deuda S/ 0.00 → S/ 0.00                                                                                                     |
  | Parada B: 3 recargas, S/ 8.00 por Yape              | pago PENDING en la bandeja; deuda S/ 0.00 → **S/ 16.00** (3 × 8.00 − 8.00)                                                  |
  | Terminar y liquidar desde su vista previa           | salieron 6, entregados 5: cerró                                                                                             |
  | Confirmar el Yape desde la bandeja                  | OK                                                                                                                          |

  Las pantallas del web (`/`, `/login`, `/customers` y el bundle) las carga el
  smoke. **Lo que NO se hizo:** hacer clic en el navegador; la parte visual del
  recorrido sigue sin testigo escrito.

  `pnpm demo:data` tal cual no corre contra demo: busca los envases «Con caño» /
  «Sin caño» del seed local, y el catálogo real (heredado de `main`) dice
  `BIDON 20L CAÑO` / `BIDON 20L NORMAL`. Se corrió una copia compilada, fuera
  del control de versiones, con sólo esos dos nombres cambiados. No se tocó el
  catálogo de demo.

**Encontrado durante el ensayo:**

1. **`admin` / `admin123` inicia sesión en demo** (`POST /api/v1/auth/login` →
   200). Es la contraseña pública del seed, y `demo` nació como copia de `main`.
   No se probó contra producción. Ver A0 abajo.
2. **`deploy-web.mjs` imprime `}` en vez de la URL.** Con salida no
   interactiva, `vercel deploy` devuelve JSON y el script toma la última línea.
   En CI no rompe nada; a mano, la URL hay que sacarla de `vercel ls yacco-web`.
3. **`vercel curl /health --deployment <url>` falla en Windows** («Malformed
   input to a URL function», CLI 59.11.2, beta). Funciona
   `vercel curl "<url>/health"`. `DEPLOY.md` quedó corregido.

### Auditoría de seguridad

Corrida con la definición de `.claude/agents/auditor-seguridad.md`, en solo
lectura: no se leyó ningún valor de secreto ni se cambió ningún recurso. Los tres
hallazgos principales se contrastaron con lo verificado en esta misma sesión.

**Criterio de clasificación.** «Bloquea el corte» = tiene que estar resuelto
antes de la fase 7, porque el corte lo vuelve explotable, lo agranda, o cierra
la ventana barata para arreglarlo. «No bloquea» = existe igual con o sin corte;
queda escrito con prioridad y **decisión del dueño pendiente**.

| #      | Hallazgo                                                                                                                                                                                                                                                                                    | Qué habilita                                                                                                                                                 | ¿Bloquea el corte?                                                                                                                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A0** | `admin`/`admin123` vale en demo; muy probablemente también en `main` (ya estaba en el backlog, «Password del admin de producción»)                                                                                                                                                          | Entrar como ADMIN a la API pública de producción con una contraseña que está en el repo                                                                      | **SÍ.** Hay que confirmarlo contra producción y rotarlo. Render ya tiene la misma exposición, pero el corte es el momento en que la API queda como puerta de entrada definitiva, y rotarla cuesta minutos. |
| A1     | El token de Vercel alcanza a TODO el team `gsinuiricoders-projects` (13 proyectos, entre ellos `v2.mareliac.pe` y `ayr.mareliac.pe`, de otros clientes)                                                                                                                                     | Quien lo obtenga publica builds en sitios de otros clientes y lee sus variables de entorno: un compromiso de Yacco pasa a ser de terceros                    | No. Existe con o sin corte. Prioridad 1 después. Operativo: si el corte cae cerca del 2026-10-16, rotar el token antes de empezar.                                                                         |
| A2     | La rama `demo` de Neon tiene la misma contraseña que `main` (rol `neondb_owner`, heredado al crear la rama y nunca rotado)                                                                                                                                                                  | Una URL "de demo" pegada en un chat o log da acceso de owner, con DDL, a la base real. La separación de secretos por entorno no existe a nivel de credencial | No. Barato: resetear la contraseña del rol en `demo`, `pnpm secrets:gcp` y redeploy.                                                                                                                       |
| A3     | El deployer lee de hecho TODOS los secretos (`run.admin` + `serviceAccountUser` sobre `yacco-api-run`, que tiene `secretAccessor` de proyecto). En los jobs con `id-token` corren `pnpm install` (postinstall de ~960 deps), `npm install -g vercel` sin lockfile y actions fijadas por tag | Una dependencia o action comprometida obtiene los JWT (fabrica tokens de ADMIN), Cloud Run y el token de Vercel (con el alcance de A1)                       | No. Arreglos baratos: `--ignore-scripts` en la CLI, actions fijadas por SHA, y anclar WIF también a `workflow_ref`.                                                                                        |
| A4     | Demo y producción comparten la identidad de runtime `yacco-api-run`, con `secretAccessor` de proyecto                                                                                                                                                                                       | Un fallo explotable en demo lee los JWT y la base de producción                                                                                              | No. Misma imagen: un RCE en demo casi siempre existe también en producción.                                                                                                                                |
| A5     | Data Access logs: 30 días en `_Default`, sin métricas ni alertas                                                                                                                                                                                                                            | Una filtración descubierta semanas después ya no tiene rastro de la lectura original, y nada avisa en el momento                                             | No. Decisión en D-016: 30 días NO alcanza.                                                                                                                                                                 |
| A6     | El web no tiene CSP, `X-Frame-Options`, `X-Content-Type-Options` ni `Referrer-Policy`; la API manda `x-powered-by: Express`; el refresh token vive en `localStorage`                                                                                                                        | Sin CSP, un XSS se lleva el refresh de 30 días; clickjacking posible                                                                                         | No. Headers en `vercel.json` y `app.disable("x-powered-by")`.                                                                                                                                              |
| A7     | `qs@6.15.3` (via express) con advisories moderados de DoS en la API pública; `FROM node:22-alpine` sin digest; escaneo de Artifact Registry apagado                                                                                                                                         | DoS de la API; imagen base que cambia entre builds sin aviso                                                                                                 | No. Override de `qs`, fijar digest, habilitar el escaneo.                                                                                                                                                  |
| A8     | Menores: WIF anclado por nombre de repo y no por id; SA por defecto de Compute Engine con `roles/editor` (no usable por el deployer)                                                                                                                                                        | Sólo con un repo renombrado y reclamado, o con acceso de owner                                                                                               | No.                                                                                                                                                                                                        |

**Verificado y limpio:** cada servicio con su propia service account (no la de
Compute Engine); sólo llaves `SYSTEM_MANAGED`; GitHub sin llaves (sólo
`SONAR_TOKEN`); secretos montados por referencia, ninguno en `vercel.json`, el
Dockerfile ni `VITE_*`; `.env.setup` ignorado y nunca en la historia; CORS de
producción sólo `yacco-web.vercel.app` (ni `evil.example`, ni `null`, ni
`onrender.com`); Swagger 404 en los dos servicios; `/health/db` sólo devuelve
`{"status":"ok"}`; la imagen corre como `node`, no root; `pnpm audit
--audit-level=high` sin nada sin justificar (el único high está ignorado con
motivo desde d4f4204).

**Los dos conocidos, evaluados:**

- **Logs a 30 días:** no alcanzan. Decisión registrada en D-016.
- **Token de Vercel de larga vida:** los 30 días acotan bien, y el preflight ya
  frena uno vencido antes de migrar. El problema real no es la duración sino el
  alcance (A1). El 2026-10-16 puede caer dentro del corte: rotarlo antes.

**Qué se arregla antes del corte, decidido por el dueño el 2026-09-16:** A0,
A2, A3 + A8 (cadena de deploy y WIF) y la parte barata de A6 (`x-powered-by` y
clickjacking), en ese orden, cada uno en su PR. A1, A4, A5, A7, la CSP completa y
el refresh token fuera de `localStorage` van al backlog.

## Fase 7 — El corte ✅

**Mecanismo:** D-019. El web de Render redirige a `yacco-web.vercel.app`; la
API de Render queda viva sobre la misma rama `main` de Neon.

### El corte, hecho — 2026-09-17 06:28 UTC

| Paso                                        | Evidencia                                                                                                                                     |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Merge del corte (#145, `6ab70cb`)        | 06:28:21 UTC. El sitio de Render se reconstruyó solo: `last-modified` 06:28:56 UTC, bundle con la redirección                                 |
| …en un navegador real                       | `https://yacco-web.onrender.com/customers` → `https://yacco-web.vercel.app/login`                                                             |
| Deploy de CI 35190541593                    | nueve jobs verdes; migraciones «No pending migrations» en demo y main                                                                         |
| 2. `pnpm smoke:prod` con `EXPECTED_COMMIT`  | 06:45 UTC: `Smoke OK.`                                                                                                                        |
| …`curl https://yacco-web.vercel.app/health` | `{"status":"ok","commit":"6ab70cbe…","environment":"production"}`                                                                             |
| 3. Render vivo sobre la misma `main`        | `https://yacco-api.onrender.com/health` → `{"status":"ok","commit":"6ab70cbe…","environment":null}` (Render no tiene `APP_ENV`; es esperable) |

### Cierre — 2026-09-23/24 (hora de Lima: la noche del 23)

Giancarlo levantó el plazo del 2026-09-24: sin usuarios reales, la fase se
cerró de corrido. **Render NO se suspendió** (no hay `RENDER_API_KEY`, y se
decidió no pedirla): la rotación de `main` le cortó la base.

| Paso                                          | Resultado                                                                                                                                                                                                                                    |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Corte del web a Nuxt (#175, `2ed19f1`)        | El deploy falló en «5 · Web a Vercel» sin publicar nada (las APIs, en `2ed19f1`; el web, todavía el React). Causa y arreglo en D-023, punto 7                                                                                                |
| Arreglo del preset de Nitro (#176, `0e0f58d`) | 9/9 jobs verdes. Las dos APIs y `/health` por `yacco-web.vercel.app` en `0e0f58d` (`production`); `/`, `/login` y `/customers/new` sirven el Nuxt con los headers A6; `smoke:prod` con `EXPECTED_COMMIT` → `Smoke OK.`                       |
| `yacco-web-nuxt` borrado                      | Desconectado de Git y borrado con `vercel api` (D-023, punto 8)                                                                                                                                                                              |
| Chequeo previo a la fase B                    | 9/9 jobs de `0e0f58d`, `smoke:prod` OK, `yacco-api` y `yacco-api-demo` `Ready` al 100%, **cero respuestas 5xx en las dos desde el corte** (2026-09-17 06:28 UTC)                                                                             |
| Rotación de la contraseña de `main` (D-017)   | Hecha el 2026-09-24 a las 03:11 UTC. La contraseña vieja de `main` (que era la vieja de demo) queda **rechazada** contra `main`; producción en la revisión `00035-4dd`; destruida la v1 de las cuatro URLs. Incidente de ~2,5 min: ver D-017 |
| Render                                        | **Vivo, pero sin acceso a la base**: `yacco-api.onrender.com/health/db` → 503 «Database is unreachable» después de reiniciar el compute de `main`                                                                                            |
| Secretos huérfanos de Render                  | Borrados `yacco-render-jwt-refresh-secret` y `yacco-tmp-render-refresh-probe` (no queda ningún secreto con «render» en el nombre)                                                                                                            |
| Render fuera del repo                         | `render.yaml` borrado; fuera las menciones operativas y la reserva `RENDER_GIT_COMMIT` de `/health` (D-009, con test)                                                                                                                        |

**Pendiente de Giancarlo, sin urgencia:** borrar los dos servicios de Render
(`yacco-api` y `yacco-web`) desde su dashboard. No sirven nada útil: la API
no llega a la base y el web es el React viejo.

**Dependabot (B6), uno por uno, con el deploy verde entre medio:**

| PR                          | Resultado                                                                                                                                                                               |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #14 `@eslint/js` 9 → 10     | **Cerrado sin mergear:** no pasó `ci`. `preserve-caught-error`, nueva en `eslint:recommended`, marcó 2 errores en `seed-demo.ts`. Arreglado aparte en #178; después se retoma la subida |
| #15 `lint-staged` 15 → 17   | Dependabot lo reemplazó por **#154** el 2026-09-17. #154 mergeado con OK (salto mayor), después de probar el hook con un commit local; deploy 9/9                                       |
| #17 `@jest/globals` 29 → 30 | Dependabot lo reemplazó por **#152** el 2026-09-17. #152 mergeado con OK (salto mayor); deploy 9/9                                                                                      |
| #126 `vitest` 3 → 4         | Dependabot lo cerró el 2026-09-18 porque vitest ya está al día (hoy en 5.0.1). Nada que hacer                                                                                           |

**Ramas de respaldo de Neon, borradas el 2026-09-24 a las 04:59 UTC por el
agente, por la API de Neon** (`DELETE /projects/late-union-50177487/branches/{id}`),
con autorización explícita de Giancarlo para esos dos ids y ninguno más.
Antes se verificó que cada id coincidía con su nombre y que ninguna era madre
de `demo`, de `main` ni de otra rama. La regla `deny` de
`neonctl branches delete` en `.claude/settings.json` no se tocó. Quedan
`main` y `demo`.

**Rotación del token de Vercel (B8): bloqueada.** La API rechazó crear el token
con la sesión de la CLI: `POST /v3/user/tokens` → `Cannot create tokens for
this app. (403)`. No se creó nada ni cambió ningún secreto: CI sigue con el
token de siempre (versión 1 de `yacco-ci-vercel-token`). Queda para Giancarlo
antes del 2026-10-16 (ver «Credenciales y recursos con fecha»).

## Antes del corte: los arreglos que lo bloquean

### A0 — Credenciales del seed en producción ✅ (2026-09-17)

**Verificado antes de tocar nada**, comparando con bcrypt en proceso (sin
imprimir hashes ni URLs): `main` tiene **un solo usuario, `admin`, y aceptaba
`admin123`**. En `demo`, lo mismo (más `chofer.demo`, creado por el recorrido
de la fase 6, con contraseña aleatoria).

1. **Respaldo** como en D-006: `backup-pre-seed-creds-20260917`
   (`br-empty-king-au95xarv`), hija de `main`, sin compute, creada
   **2026-09-17 04:34:20 UTC**, después del deploy verde de `d1dd298`.
2. **Contraseña nueva**: 24 bytes aleatorios (192 bits), base64url, generada en
   proceso. Primero a Secret Manager (`yacco-admin-initial-password`, versión
   nueva **verificada por lectura**) y recién después el hash en `main` (bcrypt,
   10 rondas, igual que `UsersService`), con un `updateMany` condicionado al hash
   viejo que exigió tocar exactamente 1 fila. Si el paso del secreto fallaba, la
   base no se tocaba. **Ningún valor se imprimió.** El dueño la lee de Secret
   Manager y la cambia.
3. **Verificado contra producción después:**

   | Endpoint de login                              | `admin` / `admin123` | `admin` / la de Secret Manager |
   | ---------------------------------------------- | -------------------- | ------------------------------ |
   | Cloud Run `yacco-api`                          | **401**              | 200                            |
   | `yacco-web.vercel.app` (rewrite)               | **401**              | 200                            |
   | Render `yacco-api.onrender.com` (misma `main`) | **401**              | —                              |

**`db:seed` no corre contra `main` desde ningún camino automático**, revisado:
`deploy.yml` sólo corre `prisma migrate deploy` (que no siembra; sólo `migrate
dev` y `migrate reset` lo hacen); `render.yaml` corre `db:deploy`; el
Dockerfile arranca `node dist/main.js`; CI siembra sólo contra Testcontainers.
No hizo falta cerrar nada. Queda un camino manual: una persona que corra
`pnpm db:seed` con la URL de `main`. Ni así pisa la contraseña (`update: {}`),
salvo que el usuario `admin` no exista: lo recrearía con `admin123`.

**Lo que la rotación NO cierra — sesiones ya emitidas.**
`AuthService.refreshAccessToken` no mira la contraseña: un refresh token
obtenido con `admin123` sigue emitiendo access tokens hasta que vence (30 días)
o hasta que cambie el `JWT_REFRESH_SECRET` de la API que lo firmó. Resuelto para Cloud Run el mismo día (ver «Sesiones emitidas con `admin123`»);
Render, pendiente de cargar su secreto en el dashboard.

### Sesiones emitidas con `admin123`: JWT de producción rotados ✅ (2026-09-17)

Cambiar la contraseña (A0) no invalidaba los refresh tokens ya emitidos: valen
30 días y `refreshAccessToken` no mira la contraseña. Rotado todo en un solo
proceso, sin imprimir secretos ni tokens:

1. **Antes**, un refresh token recién emitido por Cloud Run y otro por Render:
   los dos → **200** (sin esa línea de base, un 401 después no probaría nada).
2. Versión nueva de `yacco-production-jwt-access-secret` y
   `yacco-production-jwt-refresh-secret` (48 bytes, base64url), verificadas por
   lectura.
3. Redeploy de sólo `yacco-api` con la imagen que ya corría
   (`api:4f7b854958fe`): revisión `00013-wxc`, configuración idéntica a la
   `00012` salvo los secretos. `/health` ok, `pnpm smoke:prod` → `Smoke OK.`
4. **Después**, contra Cloud Run: refresh viejo → **401**; login nuevo → ok;
   refresh nuevo → 200.

**Render, pendiente del dueño.** Render firma con su propio
`JWT_REFRESH_SECRET`, cargado a mano en su dashboard: el refresh viejo contra
Render sigue en **200**. El valor nuevo está en Secret Manager como
`yacco-render-jwt-refresh-secret` (nunca en el chat, el PR ni un log). Una vez
cargado y reiniciado Render, se verifica con el refresh emitido en el paso 1,
guardado como `yacco-tmp-render-refresh-probe`: tiene que dar 401, y entonces
esa sonda se borra. Se le pide al agente; la sonda se borra sola si pasa.

**Demo: `admin` deja de ser `admin123`.** Contraseña aleatoria (192 bits) en
`yacco-demo-admin-password`, después el hash en la rama `demo`. Contra la API
pública de demo: `admin123` 200 → **401**; la de Secret Manager → 200. Para
`pnpm demo:data` contra demo, pasarla en `DEMO_ADMIN_PASSWORD`. **JWT de demo rotados el mismo día**, con el mismo procedimiento que producción:
refresh emitido antes → 200; versión nueva de `yacco-demo-jwt-access-secret` y
`-refresh-secret`; redeploy de sólo `yacco-api-demo` con la misma imagen;
refresh viejo → **401**, login nuevo ok, refresh nuevo → 200,
`smoke api --env=demo` OK.

### A2 — La contraseña de demo deja de ser la de main ✅ (2026-09-17)

Decisión y detalle en D-017. Resumen:

- Reset de la contraseña de `neondb_owner` en la rama `demo`; `pnpm secrets:gcp`
  creó versión nueva sólo de las dos URLs de demo.
- Redeploy de sólo `yacco-api-demo` con la misma imagen
  (`api:d09c19f38033`), `node scripts/smoke.mjs api --env=demo` → `Smoke OK.`,
  `/health/db` → 200.
- **La contraseña nueva de demo contra `main`: rechazada.**
- **La contraseña VIEJA de demo contra `main`: todavía ABRE**, porque es la de
  `main`. Se cierra rotando `main` al suspender Render (ver D-017 y «Al
  terminar la migración»).

### A3 + A8 — La cadena de deploy ✅ (2026-09-17)

Decisión y detalle en D-018.

- **Actions por SHA** en los tres workflows (10 actions distintas), con el tag
  exacto al lado.
- **`--ignore-scripts`** en el `pnpm install` de migraciones, en los dos
  `npm install -g vercel` y en el `installCommand` de `vercel.json`, que
  `vercel build` corre dentro del job web. Ningún paquete necesitó su
  postinstall (probado con una instalación limpia: Prisma baja su engine al
  primer uso, el web construye).
- **WIF**: la condición exige además `repository_id` (1339102029),
  `repository_owner_id` (71910095) y `workflow_ref` de `deploy.yml` en main.
  Aplicada con `pnpm gcp:bootstrap` ANTES del merge, para que el deploy del
  merge sea la prueba. Comprobado con `gcloud ... providers describe`.

### A6, la mitad barata — sin `x-powered-by`, sin enmarcado ✅ (2026-09-17)

- **API** (`configureApp`, así lo cubren también los tests de integración):
  `x-powered-by` deshabilitado, `X-Frame-Options: DENY` y
  `Content-Security-Policy: frame-ancestors none`, también en 404 y errores.
  Sin dependencias nuevas: un middleware de cuatro líneas en vez de Helmet.
- **Web** (`vercel.json`, `headers`): los mismos dos headers en todas las rutas.
- **Fuera, al backlog con su motivo:** la CSP completa y el refresh token fuera
  de `localStorage` («Hallazgos de la auditoría de la fase 6 que no entraron
  antes del corte»).

## Lo que falta antes de seguir

Depende del dueño, y bloquea el primer deploy desde CI. En este orden:

1. ✅ **Prender los Data Access logs de Secret Manager** con el procedimiento de
   D-015, guardando antes la política IAM original en un archivo. Hecho el
   2026-09-16: `DATA_READ` + `ADMIN_READ`, los 11 bindings verificados idénticos
   uno por uno contra el volcado.
2. ✅ **Crear el `VERCEL_TOKEN`** (vercel.com > Account Settings > Tokens, scope
   del team, **30 días**), ponerlo en `.env.setup` y correr
   `pnpm secrets:gcp --upload=VERCEL_TOKEN`.
   Subido el 2026-09-16 (versión 1, 16:03:31 UTC): todos los demás secretos
   «sin cambios», los JWT leídos de Secret Manager, ninguno rotado.
   Lo sube a Secret Manager y le da lectura al deployer. Sin él, el deploy se
   detiene en el preflight, antes de tocar ninguna base.
3. ✅ **Crear la rama de respaldo de `main`** (ver «Punto de retorno», abajo).
   Creada el 2026-09-16 a las 16:04:01 UTC.
4. ✅ **Relanzar el deploy**: `gh workflow run deploy.yml --ref main`. Ver
   «Primer deploy desde CI», abajo: hicieron falta dos arreglos.
5. **La mitad del preview de P-05**, a mano, después de ese primer deploy (ver
   `DEPLOY.md`). La mitad de producción ya la corre el smoke.

Comprobado antes de relanzar, el 2026-09-16, con `prisma migrate status` contra
las URLs directas: las ramas `main` y `demo` tienen las 25 migraciones del repo
aplicadas y ninguna pendiente. El primer deploy desde CI no cambia el esquema de
ninguna base.

## Credenciales y recursos con fecha

| Qué                                               | Fecha                                                                                                                                   | Qué hacer                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Token de Vercel (`yacco-ci-vercel-token`)         | versión 2 creada 2026-09-24, **sin vencimiento** (la 1, del 2026-09-16, destruida el 2026-09-24 después de que el deploy pasó el job 5) | Validado con `check-vercel-token` el 2026-09-24. Sin vencimiento no hay fecha que vigilar, pero tampoco un corte automático si se filtra: **rotarlo al cerrar el piloto** con uno de 30–90 días y alcance solo al proyecto (A1). Al rotar: `pnpm secrets:gcp --upload=VERCEL_TOKEN` y actualizar esta fila y D-015 |
| ~~Rama de Neon `backup-pre-ci-deploy-20260916`~~  | creada 2026-09-16 16:04:01 UTC (`br-damp-leaf-aujnr4gs`)                                                                                | **Borrada el 2026-09-24**, por la API de Neon con autorización de Giancarlo (fase 7, «Cierre»)                                                                                                                                                                                                                     |
| ~~Rama de Neon `backup-pre-seed-creds-20260917`~~ | creada 2026-09-17 04:34:20 UTC (`br-empty-king-au95xarv`)                                                                               | **Borrada el 2026-09-24**, por la API de Neon con autorización de Giancarlo (fase 7, «Cierre»)                                                                                                                                                                                                                     |
| Secreto `yacco-demo-driver-password`              | creado 2026-09-24                                                                                                                       | La contraseña de `chofer.demo.piloto` en la demo, para revisar «Mi ruta». Se lee con `gcloud secrets versions access latest --secret yacco-demo-driver-password`, nunca se pega en un chat. Se destruye cuando termine la revisión del piloto                                                                      |
| Secreto `yacco-admin-initial-password`            | 2026-09-17                                                                                                                              | **No se cambia hasta el final del proyecto** (Giancarlo, 2026-09-24). Entonces: la lee, la cambia desde la app y destruye la versión                                                                                                                                                                               |

**Un token de Vercel vencido frena el deploy en el preflight**, antes de tocar
ninguna base: `scripts/check-vercel-token.mjs` lo valida con `vercel whoami`.
El error nombra el secreto y la fecha de vencimiento, **que lee de la fila de
arriba**: al rotar el token, actualizar esa fecha (detalle en D-015).

**El vencimiento cae dentro de la fase 7.** El 2026-10-16 está dentro de la
ventana probable del corte, que tiene 7 días de convivencia con Render. **Si la
migración sigue en curso cerca de esa fecha, el token se rota ANTES**, como
tarea planificada, y no cuando un deploy falle. Un deploy que falla en el paso
5 durante el corte deja la API nueva con el web viejo, sirviendo a usuarios
reales.

**Hecho antes de la fase 7:** el preflight valida el token con `vercel whoami`
(2026-09-16). El ítem del backlog quedó resuelto.

## Punto de retorno

`backup-pre-ci-deploy-20260916` (`br-damp-leaf-aujnr4gs`), rama de Neon hija de
`main` (`br-sweet-poetry-au36xqnj`), sin compute, creada el **2026-09-16 a las
16:04:01 UTC** con `--no-compute --no-secrets`, justo antes del primer deploy
desde CI. Es el estado de la base real antes de estrenar el workflow.

Esa hora es también la del plan B por historia (`^self@2026-09-16T16:04:01Z`),
vigente sólo durante las 6 horas de retención del proyecto.

- **Borrada el 2026-09-24**, con la fase 7 cerrada sin incidentes, junto con
  `backup-pre-seed-creds-20260917` (ver «Cierre», en la fase 7). **Desde
  entonces no hay rama de respaldo de `main`:** el único punto de retorno es
  el historial de Neon, con las 6 horas de retención del proyecto. Antes de
  un cambio riesgoso sobre `main`, crear una rama nueva como en D-006.
- **Cómo se usa:** «Procedimiento: restaurar `main` desde una rama de
  respaldo», junto a D-006 en `ARQUITECTURA.md`. Incluye el paso que se olvida:
  después de restaurar, `demo` queda colgando de la rama preservada y hay que
  recrearla.

Para el auditor de seguridad de la fase 6: mientras no se prendan los Data
Access logs de Secret Manager (paso 1), las LECTURAS del token de Vercel no
quedan registradas; sí los cambios de quién puede leerlo.

`.env.setup` ya **no bloquea nada**: los scripts leen la configuración del
entorno del proceso cuando el archivo no está (D-004), y los secretos de
producción nacen en Secret Manager (D-007). El archivo sigue siendo la forma
cómoda de no repetir valores a mano en cada comando.

## Migración del web a Nuxt — `apps/web-nuxt`

Empezó en paralelo a `apps/web`, que #171 retiró del repo. Decisiones desde
D-020 en `ARQUITECTURA.md`; el corte real, que pone el Nuxt en `yacco-web`,
es D-023.

| Tanda                      | Estado   |
| -------------------------- | -------- |
| 1 — Esqueleto              | ✅ hecha |
| 2 — Sesión y capa de datos | ✅ hecha |
| 3+ — Las 22 pantallas      | ✅ hecha |
| Final — Corte              | 🟨 PR    |

### Pantallas

| #   | Pantalla (ruta React)                           | PR  | Estado |
| --- | ----------------------------------------------- | --- | ------ |
| 1   | Login (`/login`)                                | 156 | ✅     |
| 2   | Panel (`/`)                                     | 157 | ✅     |
| 3   | Clientes (`/customers`)                         | 158 | ✅     |
| 4   | Nuevo cliente (`/customers/new`)                | 158 | ✅     |
| 5   | Detalle de cliente (`/customers/:id`)           | 159 | ✅     |
| 6   | Editar cliente (`/customers/:id/edit`)          | 158 | ✅     |
| 7   | Pedidos (`/orders`)                             | 160 | ✅     |
| 8   | Nuevo pedido (`/orders/new`)                    | 160 | ✅     |
| 9   | Detalle de pedido (`/orders/:id`)               | 160 | ✅     |
| 10  | Rutas (`/routes`)                               | 161 | ✅     |
| 11  | Nueva ruta (`/routes/new`)                      | 161 | ✅     |
| 12  | Detalle de ruta (`/routes/:id`)                 | 162 | ✅     |
| 13  | Liquidación (`/routes/:id/settlement`)          | 163 | ✅     |
| 14  | Cobranzas (`/payments`)                         | 164 | ✅     |
| 15  | Inventario (`/inventory`)                       | 164 | ✅     |
| 16  | Producción (`/production`)                      | 164 | ✅     |
| 17  | Movimientos de envases (`/container-movements`) | 165 | ✅     |
| 18  | Tipos de envase (`/container-types`)            | 166 | ✅     |
| 19  | Contar envases (`/container-counts`)            | 167 | ✅     |
| 20  | Cuadre de envases (`/container-reconciliation`) | 168 | ✅     |
| 21  | Zonas (`/zones`)                                | 169 | ✅     |
| 22  | Usuarios (`/users`)                             | 170 | ✅     |

### Tanda 1 — Esqueleto

- `apps/web-nuxt`: Nuxt 4.5.2 + Nuxt UI 4.11.1, `ssr: true`, estructura
  estándar de Nuxt 4 (`app/` con `layouts`, `pages`, `assets`).
- Tema en un solo lugar: `app/assets/css/main.css` (paletas `lagoon`, `basalt`
  y `ochre`; Public Sans y Bricolage Grotesque), asignado a los papeles de Nuxt
  UI en `app/app.config.ts`.
- Proxy por host como rutas de CDN (D-021). Verificado en local con el build de
  Node: `/health` → `"environment":"demo"`; `POST /api/v1/auth/login` con
  credenciales falsas → 401 de la API de demo; headers anti-enmarcado
  presentes.
- Proyecto de Vercel `yacco-web-nuxt` creado por API y conectado al repo
  (D-020). Necesitó su propio `apps/web-nuxt/vercel.json`: sin él, Vercel tomó
  el `vercel.json` de la raíz (el del web React) y el primer preview falló.
- **Criterio de salida, verificado 2026-09-17 tras el merge de #155:**
  `curl https://yacco-web-nuxt.vercel.app/health` →
  `{"status":"ok","commit":"420f3b5…","environment":"demo"}`;
  `POST /api/v1/auth/login` con credenciales falsas por ese dominio → 401 de la
  API de demo. El login con la pantalla nueva se verifica al cerrar la tanda 2.

### Tanda 2 — Sesión y capa de datos

- `packages/shared`: contratos de auth y las reglas de dinero (`formatSoles`,
  aritmética en céntimos `bigint`) y de fechas (`formatCalendarDay` partiendo el
  texto, instantes en hora de Lima), con Vitest y su propio lcov para Sonar.
- `useApi()` como única puerta; `useSession()` con el access token en memoria
  y el refresh en `localStorage` (D-022); guard global sólo en el cliente.
- Login portado (pantalla 1) y el marco de la app con la barra lateral.
- **Criterio de salida de la tanda 1, cerrado tras el merge de #156:** contra
  `https://yacco-web-nuxt.vercel.app`, `POST /api/v1/auth/login` con el admin de
  demo (contraseña leída de `yacco-demo-admin-password` sin imprimirla) → 200
  con access y refresh; `GET /api/v1/customers` con ese token → 200;
  `POST /api/v1/auth/refresh` → 200; `/login` servido por SSR con el formulario.

### Pantallas portadas — notas por PR

- **#157 Panel.** Buscador de clientes con `UInputMenu` (combobox de Reka UI):
  espera 300 ms, límite 10, sin filtro de activo (supuesto por validar), inactivo
  marcado y elegible, error distinto de «Sin resultados» con «Reintentar».
  Suma saludo y fecha de hoy en Lima.
  Destapó que `@testing-library/jest-dom/vitest` resolvía el `vitest` que pnpm
  eleva (5, de web-nuxt) en vez del 3 de `apps/web`: en CI, `apps/web` fallaba
  al azar con «Invalid Chai property». `pnpm.packageExtensions` en la raíz lo
  declara peer opcional y cada app lo enlaza con su propio vitest.
- **#158 Clientes: lista, alta y edición.** `usePagedList` concentra la regla de
  la página: vuelve a 1 sólo cuando el filtro APLICADO cambia (el bug que el
  React arrastró semanas). Filtro de estado a un clic (`aria-pressed`), nombre
  del cliente como enlace a la ficha, «Editar» con el nombre en su nombre
  accesible. Formulario: opcionales vacíos no viajan, límite como string, zona
  retirada conservada y marcada, deuda de sólo lectura, baja con
  `active=false`.
- **#159 Ficha del cliente.** Deuda en primer plano; cobro de oficina con la
  clave de idempotencia reusada en el reintento idéntico y renovada al cambiar
  método o monto, 409 explicado sin jerga, saldo a favor que no es error y sin
  aviso de "pendiente"; precios pactados (ADMIN) o efectivos de sólo lectura;
  estado de cuenta con filas anuladas marcadas y sin `openingBalance`.
  `useApiResource` + `ResourceState` para cargar un recurso (cargando / no
  existe / error con reintento), también en la edición. `*.vue` entra en
  lint-staged: el formato de #158 falló en CI porque prettier no los veía al
  commitear.
- **#160 Pedidos: lista, alta y detalle.** Filtros de estado, rango de entrega
  (`AAAA-MM-DD` tal cual sale del campo) y cliente, con «Limpiar filtros». El
  alta prellena el precio PACTADO (marcado), reprecia al cambiar de cliente sin
  pisar lo escrito a mano, calcula el total en céntimos y manda un solo POST
  ante un doble clic; la lógica de las líneas vive en `utils/order-lines.ts`
  con tests unitarios. El detalle muestra el total de la API (no uno
  recalculado), cancela con confirmación y ante un 409 recarga el estado real.
  `CustomerPicker` sólo ofrece clientes activos.
- **#161 Rutas: lista y planificación.** Resumen de paradas por ruta (el
  desglose sólo cuando ya se resolvió alguna), filtros de día, chofer, zona y
  estado con catálogos que, si caen, dejan el filtro vacío sin romper la lista.
  Planificar crea la ruta vacía con el día de hoy en Lima; sin zona no manda
  `zoneId`; distingue «no hay choferes activos» de «no se pudo cargar la lista
  de choferes» (el React mostraba lo primero en los dos casos). `useCatalog`
  generaliza la carga de catálogos para selectores.
- **#162 Detalle de ruta.** Iniciar, terminar (el diálogo explica las paradas
  pendientes y no ofrece confirmar lo que la API rechaza; un 409 recarga), armar
  paradas desde pedidos pendientes sin ruta o autoventa, subir/bajar mandando la
  lista completa, quitar con confirmación sólo lo pendiente. Registrar la parada
  con los tres escenarios de HU-12, precio pactado por defecto y autorizador
  obligatorio sólo ante un precio distinto; resumen de venta, cobro y envases, y
  aviso de límite de crédito que nunca bloquea. Parada corregida: sello con
  quién, cuándo y motivo, y el motivo de falla sólo si sigue no entregada. Carga
  del camión con reparto FIFO previo al envío (un POST por lote). Las reglas del
  marcado y del FIFO viven en `utils/stop-mark.ts` y `utils/fifo-load.ts`, con
  tests unitarios. **Hallazgo:** `UInput type="number"` con `v-model` entrega
  un número, no texto; `positiveWhole` acepta los dos.
- **#163 Liquidación.** El libro (con cuántos llenos deberían volver), el
  conteo en la puerta con vacíos por tipo (en blanco vale cero; los tipos
  retirados que volvieron también se cuentan), diferencias en vivo con signo que
  nunca bloquean, y la liquidación cerrada con sus diferencias recalculadas. El
  aviso de liquidación desactualizada dice sólo lo que mide (una parada corregida
  después del cierre), aclara la diferencia de vacíos y no le atribuye la deriva
  de dinero a los pagos cuando hubo corrección. Reglas en `utils/settlement.ts`
  y fórmulas del libro en `packages/shared`, con tests. Los límites de día en
  Lima para filtros por instante (`limaDayStart`/`limaDayEnd`) también
  entran a `packages/shared`.
- **#164 Cobranzas, inventario y producción.** Cobranzas arranca en
  Pendiente (es el trabajo, no un filtro más); anular no cambia el estado,
  así que `canResolve` mira `voidedAt` además de `status`; rechazo y
  anulación nombran cada motivo por separado; 409/404 recargan la bandeja,
  403 explica el permiso. Inventario pivota el libro plano en una matriz
  por tipo y estado; el vacío es "no hay filas", nunca "las cantidades
  suman cero" (el bug de producción del React, cubierto con su propia
  prueba). Producción: un tipo de envase no se ofrece dos veces entre
  líneas, sobreproducción avisada sin leerse como error, doble clic manda
  un solo POST. `packages/shared/src/container-movements.ts` trae los
  contratos del ledger de envases con un test que lee `schema.prisma`
  directo para no desincronizarse del backend.
- **#165 Movimientos de envases.** Sólo las tres operaciones que la oficina
  anota a mano (ingreso, baja por daño, baja por pérdida): las que emiten
  otros procesos (llenado, ruta) no se ofrecen. El origen sólo se pregunta
  cuando la operación admite más de uno (baja por daño); ingreso y pérdida
  tienen un origen fijo y no muestran el selector. Baja por pérdida manda el
  `locationId` de la ubicación elegida, nunca el id del cliente — la matriz
  de operaciones vive en `utils/container-movements.ts`, espejo acotado de
  la del backend (un desfase se manifiesta como 400, nunca como dato
  corrupto). Un cliente sin ubicaciones muestra su propio mensaje, no un
  desplegable vacío. El historial muestra TODAS las operaciones del libro,
  filtra por tipo, tipo de envase y rango de fechas, y pagina con
  `usePagedList`. Doble clic manda un solo POST.
- **#166 Tipos de envase.** Lista activos Y retirados (la API los separa por
  `active`; la pantalla pide las dos mitades): un tipo retirado sigue siendo
  stock real en la calle y queda visible, marcado, nunca escondido. Nunca
  ofrece eliminar, sólo baja lógica. Retirar pide confirmación explícita con
  la consecuencia dicha (`WithdrawConfirm.vue`, componente compartido con
  Zonas); reactivar es un solo clic. El error de renombrar o retirar/
  reactivar viaja con el id de la fila y se muestra pegado a ella, no una
  vez arriba de la card.
- **#167 Contar envases.** El avance ("X de Y ubicaciones contadas") es
  sobre TODO el padrón, no sobre la página filtrada: se pide aparte con dos
  peticiones de una fila (`limit=1`). Clientes y ubicaciones de baja quedan
  visibles y marcados, nunca escondidos; un saldo negativo se explica como
  "el cliente devolvió más envases de los que se le registraron, falta
  registrar una entrega" (distinto del negativo de Inventario, que es
  literalmente el mismo número con otro significado). La planilla de
  conteo (`ContainerCountForm.vue`) muestra el número del sistema al lado
  del campo por tipo; un campo en blanco es "no contado", 0 es un conteo
  real; si algo difiere, la diferencia con signo se revisa ANTES de
  confirmar — información, no error. Se puede contar un tipo que la
  ubicación no tenía según el sistema. Sin filtro de zona: no hay endpoint
  de catálogo de zonas para ofrecer las opciones, y un catálogo nunca se
  deriva de otro recurso ni se escribe a mano.
- **#168 Cuadre de envases.** Deja explícito QUÉ se compara contra QUÉ: el
  libro de movimientos (reconstruido desde cero por una consulta aparte) contra
  el saldo materializado que muestran las demás pantallas — dos cuentas
  independientes a propósito, para que un descuadre no termine probando que
  algo coincide consigo mismo. El resultado esperado es la lista vacía, así
  que se muestra como buena noticia. Informa, nunca corrige. Sólo ADMIN; el
  403 genérico de Nest se traduce al vocabulario de la planta. Reusa
  `formatDifference` de `utils/settlement.ts` (mismo "+2"/"-3" con signo) en
  vez de duplicarlo.
- **#169 Zonas.** Misma forma que Tipos de envase (lectura ADMIN+SELLER,
  escritura sólo ADMIN; activas y retiradas juntas, ordenadas; retirar con
  confirmación vía `WithdrawConfirm.vue` compartido, reactivar sin ella) más
  los días de reparto: nunca obligatorios, una lista vacía se muestra como
  "Sin días definidos" y el alta OMITE `deliveryDays` en vez de mandarlo
  vacío. `DeliveryDaysField.vue` es el mismo grupo de casillas para el alta
  y para la edición en fila (con su etiqueta oculta ahí, porque el nombre
  accesible de la fila ya la identifica).
- **#170 Usuarios — última de las 22 pantallas.** Cuatro modos que se
  excluyen entre sí (alta, renombrar, cambiar contraseña, corregir roles),
  con `closeAllModes` como único lugar que los cierra a todos. Cambiar la
  contraseña NO cierra la sesión abierta de esa persona —el refresh sólo
  valida la firma y que siga activa, nunca compara contra el hash— y el
  bloque lo dice con esas palabras; lo que sí corta es desactivar, en el
  próximo refresco. Un administrador puede cambiarse la contraseña a sí
  mismo (es la forma de rotar la del entorno demo) pero no puede
  desactivarse ni quitarse a sí mismo la administración: la pantalla no lo
  ofrece en vez de dejarlo pasar y avisar después. Quitarle "Chofer" a
  alguien con rutas sin cerrar cuenta cuántas con dos `GET /routes` (una
  por estado) y AVISA con el número exacto, sin bloquear ni tocar las
  rutas —`route.driverId` es un hecho histórico—; si la consulta falla, se
  confirma igual diciendo que no se pudo. El aviso de "contraseña
  cambiada" nombra una fila y no sobrevive a un cambio de filtro ni a una
  respuesta que llega tarde sobre una lista que ya es otra.

### Tanda final — Corte (D-023)

Estado: **hecha.** #175 mergeado el 2026-09-23 con el OK de Giancarlo al
recorrido de paridad. Su deploy falló en el web y lo arregló #176; el corte
quedó verificado sobre `0e0f58d` (ver «Cierre», en la fase 7).

- **Antes del PR, `main` no se desplegaba:** #171 dejó el Dockerfile copiando
  `apps/web/package.json` y «3 · Imagen» fallaba. Las APIs, en `19a3553`; el
  web de producción, todavía el React de #170.
- `yacco-web` pasó a `rootDirectory: apps/web-nuxt` (antes `null`), aplicado
  el 2026-09-23. No afecta al deploy React que sirve hoy: un setting sólo
  cambia builds nuevos.
- Vuelta atrás: promover `dpl_DbcUwLGm5UfPVmKVtGFzignnbaUj` (React, `19a3553`).

Después del merge, el corte no está hecho sin:

1. El deploy de CI con los nueve jobs en verde y las dos APIs en el commit
   nuevo.
2. `curl https://yacco-web.vercel.app/health` → `"production"` y el commit
   nuevo, servido por el Nuxt (regla 1 de D-021).
3. El HTML de `/` y `/login` es el del Nuxt, con los headers A6.
4. `pnpm smoke:prod` con `EXPECTED_COMMIT` → `Smoke OK.`
5. Verificado el corte, se desconecta Git de `yacco-web-nuxt` y se lo borra.
   Hecho por el agente con `vercel api` (D-023, punto 8).

## Al terminar la migración

Rotar los tokens que hayan vivido en un archivo plano durante la operación:
`VERCEL_TOKEN` —que además vive en Secret Manager como `yacco-ci-vercel-token`
y hay que volver a subir con `pnpm secrets:gcp --upload=VERCEL_TOKEN` después
de rotarlo (D-015)—, y
`GH_TOKEN` / `NEON_API_KEY` si se llegaron a usar. `RENDER_API_KEY` no se
llegó a usar.

~~Borrar las ramas de respaldo~~ — **borradas el 2026-09-24** (ver «Punto de
retorno»). No hubo que restaurar: no existen `main_before_restore_*` ni
`demo_orphan_*`.

**Rotar el token de Vercel: pendiente de Giancarlo** (ver «Credenciales y
recursos con fecha»).

~~Rotar la contraseña de `main`~~ — **hecho el 2026-09-24** (D-017), sin
suspender Render: la contraseña vieja de demo ya no abre `main`.

~~Borrar la etiqueta `:demo` de Artifact Registry~~ — **borrada el 2026-09-17**
(`gcloud artifacts docker tags delete .../api:demo`, confirmado con `tags list`:
ninguna etiqueta `demo`).

## Cierre para el piloto — 2026-09-24

La cola de `docs/plan-cierre-piloto.md`, en 18 PRs (#181–#198, más #174 y
#180). Todos con los cinco checks en verde, squash sin `--admin` y con la
salida en rojo de sus tests en el cuerpo.

| Ítem                                                           | Estado                                                                               | PRs                 |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------- |
| 1 · Docs al día con el Nuxt                                    | ✅ (apareció un Parcial real: corregir una parada no tiene pantalla)                 | #182                |
| 2 · Los 10 supuestos, decididos por delegación                 | ✅                                                                                   | #183                |
| 3 · Defectos del recorrido de paridad                          | ✅ (clic perdido: 10/10 → 0/10; contraseña en la URL antes de hidratar; hidratación) | #184 #185 #186 #187 |
| 4 · Llenos que vuelven reponen su lote                         | ✅                                                                                   | #188 #189           |
| 5 · Reportes HU-19/20/21                                       | ✅                                                                                   | #191                |
| 6 · «Mi ruta» del chofer en el celular                         | ✅                                                                                   | #190 #192           |
| 7 · Sesión revocable, refresh en cookie httpOnly, CSP completa | ✅ (D-024)                                                                           | #193 #194 #195      |
| 8 · Padrón del Yacco viejo                                     | ✅ cargado en DEMO: 604 entran, 0 descartados                                        | #197 #198           |
| 9 · Entorno de revisión                                        | 🟨 demo sembrada; preview y e2e esperan el deploy                                    | #196                |
| 10 · Carga real en main                                        | ⏸ espera el [OK] del dueño y el deploy                                               | —                   |
| 11 · Cierre                                                    | 🟨 este registro; sprint-close espera el deploy                                      | —                   |

**Bloqueo que arrastra todo lo que falta:** el token de Vercel de CI. Detalle y
comando en el plan, «Estado al 2026-09-24».

Decisiones delegadas nuevas en `supuestos-por-validar.md`: 11 (llenos al
lote más antiguo), 12 (chofer en línea y sin cambiar precios), 13 («debe
desde» del reporte de deuda), 14 (padrón sin zona y sin envases).
