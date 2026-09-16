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
                    │  /api/(.*)  ──rewrite──┐             │
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

   GitHub Actions ──WIF (sin llaves)──▶ Cloud Run
                  ──VERCEL_TOKEN─────▶ Vercel
                  ──DIRECT_URL───────▶ Neon (prisma migrate deploy)
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

> **Nota al pasar, no arreglada acá.** `AGENTS.md` referencia
> `.agents/rules/sync-protocol.md`, y ese archivo no existe: el contenido vive
> en `.agents/skills/sync-protocol/SKILL.md`. Está fuera del alcance de esta
> migración, pero conviene corregir la referencia en algún PR de
> documentación.

---

## Preguntas abiertas de infraestructura

Se cierran en la fase que indica cada una, y al cerrarse se convierten en una
decisión `D-nnn` acá arriba. Cada una lleva la recomendación de hoy, para que
cerrarla sea confirmar o contradecir, no empezar de cero.

### P-01 — ¿`--min-instances=0` o `1`? _(se cierra en la fase 3)_

Con `0`, la primera request de la mañana paga el arranque en frío de NestJS más
la conexión de Prisma, y es justo cuando el dueño abre la app en la planta. Con
`1`, se paga una instancia encendida las 24 horas.

**Medido, no estimado.** Arranque en frío del build de `dist/` contra un
Postgres local, desde que se lanza el proceso hasta que `/health` contesta 200,
cinco corridas:

```
4099 ms · 3923 ms · 4081 ms · 3800 ms · 4025 ms
mediana 4025 ms
```

Son **4 segundos con la base al lado**, en una máquina de desarrollo sin
arranque de contenedor. En Cloud Run se le suma el arranque del contenedor, y
la base pasa a estar en otro datacenter (cerca, por D-002, pero no en
localhost). El número real va a ser ese o peor.

**Recomendación: `--min-instances=1`.** Cuatro segundos es demasiado para la
primera pantalla de la mañana, que es exactamente cuando el dueño abre la app
en la planta: esa primera impresión es la que decide si la herramienta "anda
lenta". Una instancia encendida cuesta poco a este tamaño, y hoy no hay tráfico
que justifique optimizar el costo antes que la experiencia.

Queda como pregunta y no como decisión porque falta medirlo **en Cloud Run**,
que es donde se cierra, en la fase 3. Si allá el arranque resultara muy por
debajo de esto, `0` vuelve a estar sobre la mesa.

### P-02 — ¿Qué significa `WEB_ORIGIN` después del rewrite? _(se cierra en la fase 4)_

Con el rewrite de Vercel, **Cloud Run deja de ver al navegador: ve a Vercel.**
Las peticiones llegan servidor a servidor, y una petición así puede no traer
`Origin` en absoluto, con lo cual el CORS de `main.ts` deja de intervenir en el
camino normal.

**Recomendación:** dejar `enableCors` puesto y `WEB_ORIGIN` apuntando al origen
de Vercel más `http://localhost:5173`, sabiendo que en el camino normal no hace
nada. Sigue cubriendo el caso de alguien que apunte un navegador directo a la
URL de Cloud Run, y `env.validation.ts` ya acepta lista separada por comas, así
que el dev local no se rompe. Lo que NO hay que hacer es tomar el "ya no hace
falta" como permiso para abrirlo a `*`.

### P-03 — ¿Cómo sabe `/health` qué commit está corriendo? _(se cierra en la fase 3)_

`env.validation.ts` declara `RENDER_GIT_COMMIT` y `/health` lo publica, para
poder comparar en segundos lo desplegado contra el tip de `main` — existe
porque un auto-deploy que nunca disparó ya pasó desapercibido una vez
(2026-08-24). Cloud Run no inyecta esa variable.

**Recomendación:** que CI pase el sha como variable de entorno al desplegar, y
que la variable pase a llamarse algo neutral respecto de la plataforma,
conservando `RENDER_GIT_COMMIT` como fallback mientras Render siga vivo. Es un
cambio de configuración, no de dominio.

### P-04 — ¿De dónde sale la rama `demo` de Neon? _(se cierra en la fase 2)_

El proyecto Neon tiene **una sola rama, `main`**. La `demo` que esta migración
necesita para el servicio de ensayo y para los previews de Vercel todavía no
existe.

**Recomendación:** crearla como rama hija de `main` con `neonctl branches
create`. Queda con una copia del esquema y de los datos del momento, que es
justo lo que un ensayo necesita. Nunca al revés: nada escrito en `demo` vuelve
a `main`.

### P-05 — ¿Cómo se apunta un preview de Vercel a la API de demo? _(se cierra en la fase 4)_

Un preview que pegue a la API de producción escribe en la base de producción.

**Recomendación:** `vercel.json` no puede tener un destino por entorno, así que
el rewrite tiene que resolverse por variable de entorno de Vercel, con valores
distintos en Production y Preview. Hay que verificarlo con un preview real, no
darlo por hecho: es el punto de esta migración donde un error se paga escribiendo
en la base equivocada.
