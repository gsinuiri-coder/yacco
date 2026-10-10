# Entornos

Qué entornos existen, qué base mira cada uno y quién puede escribir en ellos.
El riesgo que este documento existe para evitar es siempre el mismo: **un
despliegue de prueba escribiendo en la base de producción.**

Las decisiones de infraestructura detrás de esta tabla están en
[`ARQUITECTURA.md`](./ARQUITECTURA.md); cómo desplegar a cada uno, en
[`DEPLOY.md`](./DEPLOY.md).

## Los dos entornos

**Modo local (2026-09-27, decisión de Giancarlo).** Hasta terminar la app se
trabaja y se prueba sólo en local. El entorno de demo se eliminó y los dos
servicios de Cloud Run se borraron; producción se recrea con el deploy final
(`docs/infra/README.md`).

| Entorno        | Web                           | API                                      | Base de datos      | Escribe datos reales |
| -------------- | ----------------------------- | ---------------------------------------- | ------------------ | -------------------- |
| **local**      | `nuxt dev` en `:3201`         | `:3200`                                  | Postgres en Docker | no                   |
| **producción** | Vercel, dominio de producción | Cloud Run `yacco-api` — **sin servicio** | Neon, rama `main`  | **sí**               |

**Puertos locales: API en 3200, web en 3201** (desde 2026-10-10). Antes eran
3100 y 3000, y en la máquina de desarrollo otro proyecto escucha en
`127.0.0.1:3100`: el proxy de `nuxt dev` le reenviaba todo a esa API sin
avisar. Además del cambio de puerto, `nuxt dev` mira `/health` antes de
reenviar y, si no contesta la API de Yacco (`service: "yacco-api"`), responde
502 con el porqué (`apps/web-nuxt/config/local-api-guard.ts`). El `PORT` del
`.env` local manda sobre el default: tiene que decir 3200, como `.env.example`.

Producción está **congelada**: la base `main` de Neon conserva el padrón real
tal como está, nada la migra ni la escribe, y el web de `yacco-web` sigue
publicado pero sin API detrás hasta el deploy final. Ningún merge despliega:
`deploy.yml` sólo corre a mano.

Render ya no es un entorno: quedó retirado en la fase 7, vivo pero sin acceso
a ninguna base (ver `PROGRESO.md`).

## local

El único entorno que no necesita ninguna credencial de nube.

```bash
pnpm env:local     # escribe apps/api/.env desde .env.setup
pnpm demo:up       # Postgres en Docker + migraciones + seed
pnpm dev:api       # en una terminal
pnpm dev:web-nuxt  # en otra
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

**Los datos de prueba viven acá.** `pnpm demo:data` carga sobre el Postgres de
Docker un escenario con profundidad (clientes, pedidos, rutas, liquidaciones).
Es «la demo» desde el modo local: lo que antes se ensayaba en la rama `demo`
de Neon se ensaya en esta base. Nunca se cargan datos de prueba en Neon.
`pnpm demo:prueba` carga, sobre la misma base, lo que la planta tendría el
primer día (choferes, oficina, días de reparto, envases y un día completo de
«PRUEBA Planta»); se puede correr varias veces y se niega a correr contra una
base que no esté en esta máquina.

La imagen de la API también se prueba acá antes del deploy final: la misma
imagen que va a Cloud Run, corriendo en Docker contra esta base, y el smoke de
solo lectura contra ella (`docs/DEPLOY.md`, «E2E local antes del deploy
final»).

## La rama `demo` de Neon

Queda como está: no se borra ni se resetea (D-006), y ningún servicio la usa.
Sus secretos (`yacco-demo-*`) y la identidad `yacco-api-demo-run` siguen en
Google Cloud, para recrear el servicio de demo si alguna vez vuelve
(`docs/infra/README.md`). Borrar ramas de Neon está **denegado** en
`.claude/settings.json`: ningún agente lo hace, ni siquiera para recrearlas.

## producción

- **API**: servicio `yacco-api` en Cloud Run, región `us-east4`. **Borrado
  hasta el deploy final**; se recrea con el mismo nombre y región, y vuelve con
  la misma URL determinística.
- **Base**: rama `main` de Neon, proyecto `yacco-production`.
- **Web**: proyecto `yacco-web` de Vercel, despliegue de producción. Sin
  previews: el proyecto no está conectado a Git y CI ya no los publica.

Reglas que no se negocian:

- Ningún test que escriba corre contra producción. `pnpm smoke:prod` es de
  **solo lectura** y sin ninguna credencial: `/health` de la API
  (FALLA si `environment` vuelve `null`), `/health` por el dominio de producción
  de Vercel, un login con un usuario inexistente que tiene que dar 401, y la
  carga de las pantallas principales. No hay
  usuario de verificación: no existe un rol sin permisos de escritura (ver el
  backlog técnico).
- Las migraciones corren en un paso propio de CI, contra `DIRECT_URL` (la
  conexión directa, no la del pooler), antes del deploy — nunca al arrancar el
  contenedor, donde varias instancias las correrían a la vez.
- La API usa la URL **pooled** de Neon para `DATABASE_URL`. Cloud Run escala a
  varias instancias y cada una abre su propio pool; sin el pooler, las
  conexiones de Postgres se agotan antes que cualquier otra cosa.

## Qué variable vive dónde

Ningún valor de estos se imprime nunca. `pnpm env:check` dice cuáles faltan sin
mostrar ninguno.

| Variable                | local        | Cloud Run            | Vercel | GitHub Actions          |
| ----------------------- | ------------ | -------------------- | ------ | ----------------------- |
| `DATABASE_URL` (pooled) | Docker       | Secret Manager       | —      | —                       |
| `DIRECT_URL`            | Docker       | Secret Manager       | —      | Secret Manager, por WIF |
| `JWT_ACCESS_SECRET`     | `.env` local | Secret Manager       | —      | —                       |
| `JWT_REFRESH_SECRET`    | `.env` local | Secret Manager       | —      | —                       |
| `JWT_*_EXPIRES_IN`      | `.env` local | variable en claro    | —      | —                       |
| `WEB_ORIGIN`            | `.env` local | variable en claro    | —      | —                       |
| `PORT`                  | 3200         | lo inyecta Cloud Run | —      | —                       |
| `VERCEL_TOKEN`          | `.env.setup` | —                    | —      | Secret Manager, por WIF |

El web (`apps/web-nuxt`) no tiene ninguna variable: le pide todo a `/api/v1`
de su propio origen, y a qué API llega lo decide el host en las rutas del
Build Output (D-021, D-023), no una variable. Si algún día hiciera falta una,
ojo con `runtimeConfig.public` / `NUXT_PUBLIC_*`: viajan en el HTML que
descarga el navegador, así que nunca un secreto.
