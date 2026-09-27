# Infraestructura en modo local — qué se borró y cómo se recrea

**Decisión de Giancarlo, 2026-09-27.** Hasta terminar la app se trabaja y se
prueba sólo en local (Docker). Se eliminó el entorno de demo, y los dos
servicios de Cloud Run —`yacco-api` y `yacco-api-demo`— se borraron el
2026-09-27, después de mergear #263, y se recrean con el deploy final. Mientras tanto nada se despliega: `deploy.yml`
sólo corre a mano (`docs/DEPLOY.md`).

Este archivo es el respaldo de lo que había y la receta para volver.

## Lo que había, al 2026-09-27

Los dos servicios corrían el commit `52dc5ba` (#260), desplegado por la
corrida 36304499658 de Deploy.

| Servicio         | URL determinística (la que usa el web)                 | URL con hash                                     | Revisión                   |
| ---------------- | ------------------------------------------------------ | ------------------------------------------------ | -------------------------- |
| `yacco-api`      | `https://yacco-api-297699663114.us-east4.run.app`      | `https://yacco-api-rngajdr5pa-uk.a.run.app`      | `yacco-api-00088-v79`      |
| `yacco-api-demo` | `https://yacco-api-demo-297699663114.us-east4.run.app` | `https://yacco-api-demo-rngajdr5pa-uk.a.run.app` | `yacco-api-demo-00090-kfw` |

Imagen de los dos (la única que conserva el registro):
`us-east4-docker.pkg.dev/yacco-v2-prod/yacco/api:52dc5baf6f17`, digest
`sha256:3a9318126ba41bce12156e44aaeb3a73fa1c3b0ee3fe5a03174b6954c2bc25f5`.

La configuración completa de cada uno, exportada con
`gcloud run services describe <svc> --format=export`, está al lado:
[`cloud-run-yacco-api.yaml`](./cloud-run-yacco-api.yaml) y
[`cloud-run-yacco-api-demo.yaml`](./cloud-run-yacco-api-demo.yaml). No
contienen ningún valor secreto: los cuatro secretos van por referencia
(`secretKeyRef`, versión `latest`), y lo que va en claro es `APP_ENV`,
`WEB_ORIGIN`, `DEPLOYED_COMMIT` y los `JWT_*_EXPIRES_IN`.

## De dónde saca el web la URL de la API

De ningún lado configurable en Vercel: está escrita en el código.
`apps/web-nuxt/config/api-proxy.ts` (`PRODUCTION_API_ORIGIN`) arma las rutas
del Build Output que Vercel evalúa en su CDN (D-011, D-012, D-021), y
`scripts/smoke.mjs` (`TARGETS`) repite las mismas URLs para el smoke y la
guardia de `deploy-web.mjs`. El proyecto `yacco-web` no tiene variables de
entorno para esto.

Son las URLs **determinísticas** de Cloud Run
(`https://<servicio>-<número de proyecto>.<región>.run.app`). Recrear un
servicio con el **mismo nombre y la misma región** (`yacco-api`, `us-east4`,
proyecto `297699663114`) devuelve la misma URL: **no hay nada que cambiar en
Vercel ni en el código.**

Si alguna vez se recrea con otro nombre o región, hay que cambiar
`PRODUCTION_API_ORIGIN` (y `DEMO_API_ORIGIN`) en `api-proxy.ts` y `TARGETS` en
`smoke.mjs`, en un PR, y volver a publicar el web: sin eso el dominio de
producción le habla a una URL que no existe.

## Lo que queda en pie

Nada de esto se borró, y nada de esto hay que volver a crear:

- **Neon**: las ramas `main` (producción, con el padrón real) y `demo`, tal
  como estaban. Nunca se borran ni se resetean.
- **Secret Manager** (proyecto `yacco-v2-prod`), 13 secretos, todos con su
  valor:
  - producción: `yacco-production-database-url`, `yacco-production-direct-url`,
    `yacco-production-jwt-access-secret`, `yacco-production-jwt-refresh-secret`,
    `yacco-production-smoke-viewer-password`, `yacco-admin-initial-password`;
  - demo: `yacco-demo-database-url`, `yacco-demo-direct-url`,
    `yacco-demo-jwt-access-secret`, `yacco-demo-jwt-refresh-secret`,
    `yacco-demo-admin-password`, `yacco-demo-driver-password`;
  - CI: `yacco-ci-vercel-token`.
- **Service accounts**: `yacco-deployer` (CI, `roles/run.admin` +
  `roles/artifactregistry.writer`), `yacco-api-run` (runtime de producción,
  lee sólo sus cuatro secretos), `yacco-api-demo-run` (runtime de demo, ídem
  con los suyos). D-025.
- **Workload Identity Federation**: pool `github`, proveedor `github-oidc`,
  anclado a este repositorio, a `main` y a `.github/workflows/deploy.yml`
  (`scripts/wif-condition.mjs`).
- **Artifact Registry**: el repositorio `yacco` (Docker, `us-east4`), con la
  imagen de `52dc5ba` (ver abajo).
- **Auditoría de secretos** (D-016): el bucket de logs y la alerta por email.
- **Vercel**: el proyecto `yacco-web` con su último deploy de producción. El
  web sigue publicado, pero sin API detrás: `/api/*` y `/health` fallan hasta
  el deploy final.

## Recrear `yacco-api` en el deploy final (el camino normal)

El propio workflow recrea el servicio: `gcloud run deploy` crea el servicio
si no existe, y el deployer tiene `roles/run.admin` para crearlo y hacerlo
público (`--allow-unauthenticated`). No hay un paso aparte.

1. **Decidir `min-instances`** (Giancarlo, D-008). El valor vive en
   `ENVIRONMENTS.production.minInstances` de `scripts/deploy-api.mjs` (hoy
   `"1"`). Si cambia, va en un PR antes del deploy.
2. **E2E local** sobre la punta de `main`: `docs/DEPLOY.md`, «E2E local antes
   del deploy final». Sin `Smoke OK.` no se sigue.
3. **Rama de respaldo de Neon** desde `main` (D-006), con fecha en el nombre.
   Es la vuelta atrás de las migraciones.
4. **Fuera de 08:00–20:00 America/Lima**, lanzar el deploy:

   ```bash
   gh workflow run deploy.yml --ref main
   gh run watch "$(gh run list --workflow deploy.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
   ```

   Migra `main`, construye la imagen, crea `yacco-api`, publica el web y corre
   el smoke de producción con la cuenta VIEWER.

5. **Verificar** que el servicio quedó como el que se borró:

   ```bash
   gcloud run services describe yacco-api --region=us-east4 --project=yacco-v2-prod \
     --configuration=yacco --format=export > /tmp/yacco-api-nuevo.yaml
   diff docs/infra/cloud-run-yacco-api.yaml /tmp/yacco-api-nuevo.yaml
   ```

   Diferencias esperadas: imagen, `DEPLOYED_COMMIT`, nonce y versión de
   gcloud, y `minScale` si se cambió. Una que conviene mirar: el servicio
   borrado tenía la anotación de servicio `run.googleapis.com/maxScale: '12'`,
   que `deploy-api.mjs` no pone (el tope por revisión, `--max-instances=10`,
   sí). Si se quiere igual, `gcloud run services update yacco-api --max=12`.

6. `pnpm smoke:prod` a mano, y `curl -s https://yacco-web.vercel.app/health`
   tiene que decir `"environment": "production"`.

### A mano, sin el workflow (sólo si hace falta)

Desde el YAML respaldado, con la imagen de `52dc5ba` que el registro
conserva:

```bash
gcloud run services replace docs/infra/cloud-run-yacco-api.yaml \
  --region=us-east4 --project=yacco-v2-prod --configuration=yacco
gcloud run services add-iam-policy-binding yacco-api --region=us-east4 \
  --project=yacco-v2-prod --configuration=yacco \
  --member=allUsers --role=roles/run.invoker
```

`replace` no hace público el servicio: el segundo comando es obligatorio, o
el web recibe 403. Este camino **no se probó**: el YAML exportado trae campos
de sólo lectura (`run.googleapis.com/urls`, `ingress-status`,
`satisfiesPzs`, el `nonce`) que gcloud suele ignorar; si los rechaza, se
borran del archivo y se repite. **Ojo:** esto corre el código de `52dc5ba`. Sólo sirve si
`main` de Neon no recibió migraciones posteriores; si las recibió, el camino
es el workflow.

## Recrear `yacco-api-demo` (sólo si la demo vuelve)

La rama `demo` de Neon, sus secretos y `yacco-api-demo-run` siguen ahí.

```bash
pnpm deploy:api --env=demo      # build + push + deploy, min-instances 0
```

o `gcloud run services replace docs/infra/cloud-run-yacco-api-demo.yaml` más
el mismo `add-iam-policy-binding` con `yacco-api-demo`. Volver a tener demo
también es volver a poner en `deploy.yml` los jobs que se sacaron el
2026-09-27 (el commit de «ci: modo local» los tiene en su versión anterior).

## Vercel

- **Previews**: el proyecto `yacco-web` no está conectado a ningún repositorio
  de Git (verificado por la API el 2026-09-27: sin `link`), así que Vercel no
  crea previews por su cuenta. El único que los creaba era el job
  `web-preview` de `deploy.yml`, que ya no existe, y
  `pnpm deploy:web --preview` se niega. No hubo nada que apagar en Vercel.
- **Producción**: queda como está, sin desplegar hasta el deploy final (job 5).

## Artifact Registry

- **Borrado único, 2026-09-27** (sin política de limpieza: una política corre
  sola cada día y, el día del deploy final, se llevaría la imagen nueva o
  habría que acordarse de sacarla). Se listaron las 91 imágenes de `api` con
  su digest y sus tags, y se borraron las 90 que no eran el digest de
  `52dc5ba`, primero el índice OCI `f66c8c775dac` (para no chocar con sus
  manifiestos hijos) y después el resto, una por una:

  ```bash
  gcloud artifacts docker images delete     us-east4-docker.pkg.dev/yacco-v2-prod/yacco/api@<digest>     --delete-tags --quiet --project=yacco-v2-prod --configuration=yacco
  ```

  Quedó sólo `api:52dc5baf6f17`
  (`sha256:3a9318126ba41bce12156e44aaeb3a73fa1c3b0ee3fe5a03174b6954c2bc25f5`).
  Nada borra imágenes de forma automática: la que suba el deploy final se
  queda. Si después se quiere una política permanente, que conserve varias
  versiones y borre sólo las viejas (`olderThan`), nunca una que conserve
  una sola.

- **Escaneo de vulnerabilidades**: Artifact Analysis cobra por imagen
  escaneada, y el escaneo automático estaba activo desde 2026-09-16. Se apagó
  el 2026-09-27 deshabilitando la API `containerscanning.googleapis.com` (la
  que estaba activa; `ondemandscanning.googleapis.com` nunca se habilitó). El
  repositorio quedó en `SCANNING_DISABLED`. `containeranalysis.googleapis.com`
  sigue habilitada: guarda metadatos y no cobra por imagen.

  Para volver a encenderlo:

  ```bash
  gcloud services enable containerscanning.googleapis.com     --project=yacco-v2-prod --configuration=yacco
  gcloud artifacts repositories update yacco --location=us-east4     --project=yacco-v2-prod --configuration=yacco --allow-vulnerability-scanning
  ```

  Escanea sólo las imágenes que se suban desde ese momento. El contenido de
  la imagen lo sigue revisando CI en cada PR (`check-api-image.mjs`, D-026),
  que es lo que el escaneo marcaba.
