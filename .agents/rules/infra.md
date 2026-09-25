# Infraestructura y secretos

Capítulo de `AGENTS.md`, separado por tamaño: `AGENTS.md` tiene un tope de
12.000 caracteres y ya está en 11.256 (decisión D-005 en
`docs/ARQUITECTURA.md`). **Ante conflicto, `AGENTS.md` manda.** Nada de acá lo
contradice; lo extiende.

Contexto: la API vive en Google Cloud Run y el web en Vercel, con la base en
Neon. El porqué está en `docs/ARQUITECTURA.md`, qué entorno mira qué base en
`docs/ENTORNOS.md`, y los comandos en `docs/DEPLOY.md`.

## Secretos

- **Ningún valor secreto se imprime nunca.** Ni en un log, ni en un mensaje de
  error, ni en el resumen de un agente. Se reporta el método y el resultado, no
  el valor. `pnpm env:check` es el modelo: dice qué falta sin mostrar nada.
- **Ninguna credencial viaja por argv.** `--token` nunca: `gh`, `vercel` y
  `neonctl` leen el suyo del entorno del proceso hijo, y un valor secreto llega
  a un CLI por stdin. Los argumentos son visibles en `ps` y quedan en el
  historial del shell.
- Un comando que puede imprimir una credencial **aunque salga bien** se llama
  con `quiet: true` (`neonctl connection-string`, `gcloud secrets versions
access`, `vercel env pull`).
- Los errores de `run` se arman **sin repetir los argumentos**: reimprimirlos
  es la forma más fácil de filtrar lo que el resto del diseño protege.
- Ningún agente lee `.env.setup` directamente. Lo lee `scripts/lib.mjs`, y
  sigue valiendo la regla de `AGENTS.md`: **el agente no lee ni escribe
  archivos `.env*`.** Los completa una persona; los secretos generados los
  escribe `pnpm secrets:generate`.
- `.env.setup.example` sí se commitea: es la única documentación de qué
  significa cada clave, y por eso no lleva ningún valor real.
- Nada de llaves JSON de service account. GitHub Actions entra a Google Cloud
  por Workload Identity Federation, y el proveedor tiene que estar restringido
  a **este** repositorio: uno que confíe en cualquier repo de GitHub deja que
  el workflow de un tercero emita tokens contra el proyecto.
- Lo que vaya a `runtimeConfig.public` de Nuxt (o a una `NUXT_PUBLIC_*`) **viaja
  en el HTML** que descarga el navegador. Lo que se ponga ahí queda publicado,
  no configurado: nunca un secreto. Hoy el web no tiene ninguna variable.

## Autonomía

- En decisiones de **infraestructura** —región, tamaño de instancia, forma del
  Dockerfile, mecánica de CI— el agente elige, lo registra como `D-nnn` en
  `docs/ARQUITECTURA.md` y sigue.
- En cualquier cosa que toque **dominio, schema, auth o producto**, para y
  pregunta. Vale la regla de `AGENTS.md`: una ambigüedad de dominio no se
  resuelve eligiendo la opción más fácil de programar.
- Si un comando externo falla tres veces, se documenta el bloqueo y se sigue
  con lo que no dependa de él.
- Explícitamente **fuera de alcance**, aunque suenen razonables durante una
  migración: sesiones revocables con tabla `sessions`, IDs generados en el
  cliente, tombstones, columnas de versión, y cualquier decisión sobre la app
  del conductor.

## gcloud: siempre contra Yacco

- **Ningún comando de Yacco depende del proyecto por defecto de la máquina.**
  En la del dueño, la configuración `default` de gcloud apunta a
  `ayr-steel-erp`, de OTRO cliente: un `gcloud` sin proyecto explícito lee,
  cobra y ofrece habilitar APIs allá. Nunca se contesta que sí a ese
  ofrecimiento.
- Los scripts de `scripts/` validan `GCP_PROJECT_ID` con `resolveGcpProject`
  (sólo `yacco-v2-prod`) y lanzan gcloud por `run()`, que corta cualquier
  `--project`/`--billing-project` ajeno y fija `CLOUDSDK_CORE_PROJECT` al de
  Yacco, así que hasta un comando sin `--project` resuelve acá. Un comando
  nuevo lleva `--project=${projectId}` igual: la variable es la red, no la
  costumbre.
- A mano (el agente o una persona), se usa la configuración con nombre
  `yacco` (cuenta del dueño, `core/project` y `billing/quota_project` en
  `yacco-v2-prod`) SIN activarla, porque la `default` es la del otro cliente:
  `gcloud ... --configuration=yacco`, o `CLOUDSDK_ACTIVE_CONFIG_NAME=yacco`
  para una sesión entera. Además `--project=yacco-v2-prod` en todo comando
  que lo acepte.
- En `ayr-steel-erp` no se toca nada, ni para leer, salvo una verificación
  pedida explícitamente.

## Despliegue

- **Siempre demo antes que producción.** Se despliega el servicio de demo, se
  verifica, y recién entonces producción.
- Las migraciones corren en un **paso propio de CI**, contra `DIRECT_URL`,
  antes del deploy. **Nunca al arrancar el contenedor**: Cloud Run levanta
  varias instancias y todas correrían `migrate deploy` a la vez.
- `DATABASE_URL` usa la URL **pooled** de Neon; la directa es sólo para
  migraciones. Cada instancia abre su propio pool.
- Los deploys de preview **nunca** pegan a la API de producción: apuntan al
  servicio de demo. Escribir en la base equivocada es el error más caro de esta
  arquitectura.
- Ningún test que escriba corre contra producción. `pnpm smoke:prod` es de solo
  lectura y no lleva credenciales. Si se agrega rate limiting al login, revisar
  su paso de login rechazado (comentario en `scripts/smoke.mjs`).
- Los secretos de GitHub no guardan ninguna llave de larga vida. Lo que CI
  necesita lo lee de Secret Manager por WIF (D-014, D-015). Si algo no se puede
  hacer con WIF, se para y se pregunta.
- Los scripts de infraestructura son **idempotentes**: corribles dos veces sin
  romper ni duplicar nada.
- Swagger va deshabilitado o protegido en producción.

## Vuelta atrás

- El web vuelve atrás promoviendo en Vercel un deploy anterior de `yacco-web`
  (D-023). Después de un Instant Rollback, los deploys nuevos no toman el
  dominio hasta «Undo Rollback» o `vercel promote <deploy nuevo>`: cerrar
  siempre el rollback. Procedimiento en `docs/DEPLOY.md`.
- Render quedó retirado en la fase 7, sin acceso a ninguna base: no es vuelta
  atrás.
