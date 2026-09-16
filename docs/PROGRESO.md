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
| 3 — La API en Cloud Run | ⬜ pendiente |
| 4 — El web en Vercel    | ⬜ pendiente |
| 5 — CI/CD               | ⬜ pendiente |
| 6 — Ensayo              | ⬜ pendiente |
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

## Lo que falta antes de seguir

Una sola cosa depende del dueño, y bloquea recién la fase 4:

- **Crear un `VERCEL_TOKEN`** en vercel.com > Account Settings > Tokens. Es el
  único token que hace falta sí o sí: el deploy del web corre en GitHub
  Actions, donde no hay sesión de `vercel login`. Para el resto (`gcloud`,
  `gh`, `neonctl`) alcanza con la sesión interactiva de la máquina.

`.env.setup` ya **no bloquea nada**: los scripts leen la configuración del
entorno del proceso cuando el archivo no está (D-004), y los secretos de
producción nacen en Secret Manager (D-007). El archivo sigue siendo la forma
cómoda de no repetir valores a mano en cada comando.

## Al terminar la migración

Rotar los tokens que hayan vivido en un archivo plano durante la operación
(`VERCEL_TOKEN`, y `GH_TOKEN` / `NEON_API_KEY` / `RENDER_API_KEY` si se
llegaron a usar).
