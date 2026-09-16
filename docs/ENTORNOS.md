# Entornos

Qué entornos existen, qué base mira cada uno y quién puede escribir en ellos.
El riesgo que este documento existe para evitar es siempre el mismo: **un
despliegue de prueba escribiendo en la base de producción.**

Las decisiones de infraestructura detrás de esta tabla están en
[`ARQUITECTURA.md`](./ARQUITECTURA.md); cómo desplegar a cada uno, en
[`DEPLOY.md`](./DEPLOY.md).

## Los cuatro entornos

| Entorno        | Web                           | API                        | Base de datos      | Escribe datos reales |
| -------------- | ----------------------------- | -------------------------- | ------------------ | -------------------- |
| **local**      | `vite dev`, `:5173`           | `:3100`                    | Postgres en Docker | no                   |
| **demo**       | previews de Vercel            | Cloud Run `yacco-api-demo` | Neon, rama `demo`  | no                   |
| **producción** | Vercel, dominio de producción | Cloud Run `yacco-api`      | Neon, rama `main`  | **sí**               |
| **Render**     | static site (se apaga)        | `yacco-api.onrender.com`   | Neon, rama `main`  | **sí**               |

Render aparece porque durante la migración sigue vivo. Ver "Los 7 días de
convivencia" más abajo: es el plan de vuelta atrás, no un entorno que se use.

## local

El único entorno que no necesita ninguna credencial de nube.

```bash
pnpm env:local     # escribe apps/api/.env y apps/web/.env desde .env.setup
pnpm demo:up       # Postgres en Docker + migraciones + seed
pnpm dev:api       # en una terminal
pnpm dev:web       # en otra
```

`env:local` apunta siempre al Postgres de Docker y **nunca** a Neon. El puerto
lo averigua, no lo asume: `docker-compose.yml` declara 5432, pero
`docker-compose.override.yml` —ignorado por git, distinto en cada máquina—
puede remapearlo. En la máquina del dueño está en **5433**, y el 5432 lo
contesta otro servidor de Postgres que devuelve un error de autenticación
engañoso, como si la contraseña estuviera mal.

`demo:up` levanta sólo Postgres. MinIO **no** arranca con ese comando y nada de
la demo lo necesita; si alguna vez hace falta, se levanta a mano con
`docker compose up -d minio`.

## demo

El entorno de ensayo. Es donde se verifica un despliegue antes de tocar
producción, y es adonde apuntan los previews de Vercel.

- **API**: servicio `yacco-api-demo` en Cloud Run, misma imagen y misma
  configuración que producción, con otros secretos.
- **Base**: rama `demo` de Neon (`br-dawn-field-autu1p5w`), hija de `main`.
  Nació con una copia del esquema y los datos del momento. **El flujo es en un
  solo sentido**: `main` puede refrescar `demo`, nada de lo escrito en `demo`
  vuelve a `main`.
- **Web**: los deploys de preview de Vercel.

Refrescar la demo con el estado actual de producción, cuando haga falta:

```bash
neonctl branches reset demo --parent --project-id "$NEON_PROJECT_ID" --org-id "$NEON_ORG_ID"
```

Borrar ramas de Neon está **denegado** en `.claude/settings.json`: ningún
agente lo hace, ni siquiera para recrearlas.

## producción

- **API**: servicio `yacco-api` en Cloud Run, región `us-east4`.
- **Base**: rama `main` de Neon, proyecto `yacco-production`.
- **Web**: proyecto de Vercel, despliegue de producción.

Reglas que no se negocian:

- Ningún test que escriba corre contra producción. `pnpm smoke:prod` es de
  **solo lectura**: `/health`, un login de verificación sin permisos de
  escritura, y la carga de las pantallas principales.
- Las migraciones corren en un paso propio de CI, contra `DIRECT_URL` (la
  conexión directa, no la del pooler), antes del deploy — nunca al arrancar el
  contenedor, donde varias instancias las correrían a la vez.
- La API usa la URL **pooled** de Neon para `DATABASE_URL`. Cloud Run escala a
  varias instancias y cada una abre su propio pool; sin el pooler, las
  conexiones de Postgres se agotan antes que cualquier otra cosa.

## Qué variable vive dónde

Ningún valor de estos se imprime nunca. `pnpm env:check` dice cuáles faltan sin
mostrar ninguno.

| Variable                | local        | Cloud Run            | Vercel | GitHub Actions   |
| ----------------------- | ------------ | -------------------- | ------ | ---------------- |
| `DATABASE_URL` (pooled) | Docker       | Secret Manager       | —      | —                |
| `DIRECT_URL`            | Docker       | Secret Manager       | —      | secreto del repo |
| `JWT_ACCESS_SECRET`     | `.env` local | Secret Manager       | —      | —                |
| `JWT_REFRESH_SECRET`    | `.env` local | Secret Manager       | —      | —                |
| `JWT_*_EXPIRES_IN`      | `.env` local | variable en claro    | —      | —                |
| `WEB_ORIGIN`            | `.env` local | variable en claro    | —      | —                |
| `PORT`                  | 3100         | lo inyecta Cloud Run | —      | —                |
| `VITE_API_BASE_URL`     | `.env` local | —                    | build  | —                |
| `VERCEL_TOKEN`          | `.env.setup` | —                    | —      | secreto del repo |

`VITE_API_BASE_URL` merece una nota: Vite **hornea** las `VITE_*` en el bundle
que descarga el navegador. No es configuración de runtime y no puede contener
un secreto: lo que se ponga ahí queda publicado.

## Los 7 días de convivencia

Después del corte, Render queda vivo **apuntando a la misma rama `main` de
Neon** que Cloud Run, durante 7 días. Esa es la única razón por la que la vuelta
atrás es real: si los dos no compartieran la base, volver a Render perdería
todo lo escrito mientras tanto.

La consecuencia hay que decirla en voz alta: **una migración que corra en CI le
cambia el esquema a Render en el mismo instante.** Por eso las migraciones son
expand/contract, y por eso en esos 7 días no se mergea ninguna que no lo sea.
Pasado el plazo sin incidentes, se suspende Render y `render.yaml` se borra en
un commit propio.
