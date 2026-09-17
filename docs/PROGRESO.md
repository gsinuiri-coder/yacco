# Progreso de la migración a Cloud Run + Vercel

Bitácora de la migración, por fase. Se actualiza al cerrar cada sesión de
trabajo. El _por qué_ de cada decisión está en
[`ARQUITECTURA.md`](./ARQUITECTURA.md); acá está sólo qué quedó hecho y qué
falta.

**Objetivo, en orden de importancia:** (1) llevar la API de Render a Google
Cloud Run; (2) llevar el web a Vercel. Todo lo demás del stack se mantiene. La
app funciona al cerrar cada fase.

## Estado por fase

| Fase                    | Estado       |
| ----------------------- | ------------ |
| 0 — Descubrimiento      | ✅ hecha     |
| 1 — Base del repo       | ✅ hecha     |
| 2 — Google Cloud        | ✅ hecha     |
| 3 — La API en Cloud Run | ✅ hecha     |
| 4 — El web en Vercel    | ✅ hecha     |
| 5 — CI/CD               | ✅ hecha     |
| 6 — Ensayo              | ✅ hecha     |
| 7 — Corte               | ⬜ pendiente |

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

| Qué                                          | Fecha                                                    | Qué hacer                                                                                                           |
| -------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Token de Vercel (`yacco-ci-vercel-token`)    | creado 2026-09-16, **vence 2026-10-16**                  | Rotarlo antes: token nuevo en `.env.setup`, `pnpm secrets:gcp --upload=VERCEL_TOKEN` y actualizar esta fila y D-015 |
| Rama de Neon `backup-pre-ci-deploy-20260916` | creada 2026-09-16 16:04:01 UTC (`br-damp-leaf-aujnr4gs`) | **La borra el dueño DESPUÉS de la fase 7, no antes**                                                                |
| Etiqueta `api:demo` en Artifact Registry     | de la fase 3, apunta a `f66c8c775dac`                    | La borra el dueño; sin apuro, nada despliega por ella (D-014)                                                       |

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

- **Se conserva hasta DESPUÉS de la fase 7.** Mientras Render siga vivo, la base
  tiene dos escritores y la vuelta atrás puede necesitarla. Recién con el corte
  cerrado y sin incidentes se borra, y la borra una persona: los agentes tienen
  denegado borrar ramas de Neon.
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

## Al terminar la migración

Rotar los tokens que hayan vivido en un archivo plano durante la operación:
`VERCEL_TOKEN` —que además vive en Secret Manager como `yacco-ci-vercel-token`
y hay que volver a subir con `pnpm secrets:gcp --upload=VERCEL_TOKEN` después
de rotarlo (D-015)—, y
`GH_TOKEN` / `NEON_API_KEY` / `RENDER_API_KEY` si se llegaron a usar.

Borrar la rama de respaldo `backup-pre-ci-deploy-20260916` (ver «Punto de
retorno»), sólo cuando la fase 7 haya cerrado sin incidentes. Si hubo que
restaurar en algún momento, borrar también `main_before_restore_*` y
`demo_orphan_*`, una vez que no haga falta recuperar nada de ahí.

Borrar la etiqueta `:demo` de la imagen en Artifact Registry
(`us-east4-docker.pkg.dev/yacco-v2-prod/yacco/api:demo`). Apunta a
`f66c8c775dac`, una imagen de la fase 3, y desde el PR #135 ningún deploy la
mueve (D-014): es un puntero desactualizado que alguien podría leer como «lo que
está en demo». La borra el dueño; el deployer no tiene `tags.delete`, a
propósito. No hay apuro: nada despliega por ella.

```bash
gcloud artifacts docker tags delete \
  us-east4-docker.pkg.dev/yacco-v2-prod/yacco/api:demo --quiet
```
