# DESIGN.md — Yacco (apps/web)

Este documento se deriva de `apps/web/src/styles.css` tal como existe hoy. No
es una lista de deseos: lo que no está implementado en el CSS no se describe
acá como si existiera. Ver `PRODUCT.md` para el contexto de producto (a quién
sirve esta pantalla y con qué criterio se juzga).

## Decisión de fondo: sin framework CSS, tema claro único

Documentado como comentario de cabecera en `styles.css` y elevado acá para
que quede registrado como decisión deliberada, no como accidente:

- **Sin framework CSS a propósito.** La app no trae ninguna dependencia de
  UI en tiempo de ejecución; una capa de tokens más un puñado de clases de
  componente alcanza para la superficie completa de la app.
- **Tema claro único, a propósito.** Esta es una pantalla de back-office que
  se muestra en la pantalla propia de la planta durante la demo; una
  variante oscura a medio terminar se ve peor que no tenerla. `color-scheme:
light` mantiene los controles nativos (selects, checkboxes, scrollbars) en
  línea con esa decisión.

Ninguna de las dos es un límite técnico: son una elección de alcance para una
herramienta operativa interna (ver `PRODUCT.md`), y cualquier cambio a ellas
es una decisión de producto, no un fix de diseño.

## Paleta (tokens reales, `:root` en `styles.css`)

### Superficies y bordes

| Token              | Valor     | Uso                                                                         |
| ------------------ | --------- | --------------------------------------------------------------------------- |
| `--bg`             | `#f5f7f9` | Fondo de página (`body`)                                                    |
| `--surface`        | `#ffffff` | Cards, inputs, resultados de combobox                                       |
| `--surface-sunken` | `#fafbfc` | Encabezado de tabla, `.stat`, inputs deshabilitados, fila de tabla en hover |
| `--border`         | `#e2e6ea` | Bordes de card, separadores de toolbar/tabla/paginación                     |
| `--border-strong`  | `#c9d1d8` | Bordes de input, botón secundario, combobox                                 |

### Texto

| Token           | Valor     | Uso                                                                 |
| --------------- | --------- | ------------------------------------------------------------------- |
| `--text`        | `#16212c` | Texto principal, encabezados                                        |
| `--text-muted`  | `#566674` | Texto secundario (subtítulos, etiquetas de campo, celda secundaria) |
| `--text-subtle` | `#62707d` | Texto terciario (hints, placeholder, thead, notas de `.stat`)       |

### Marca y estado

| Token             | Valor     | Uso                                                    |
| ----------------- | --------- | ------------------------------------------------------ |
| `--brand`         | `#0d6d99` | Acento primario, links, borde de foco de nav activo    |
| `--brand-hover`   | `#0a587c` | Hover de botón primario, texto de badge info           |
| `--brand-soft`    | `#e9f2f7` | Fondo de nav activo, badge info, hover de combobox     |
| `--focus`         | `#2b9bd0` | Anillo de foco (`:focus-visible`)                      |
| `--danger`        | `#a92027` | Texto de error, deuda (`.money--owed`), badge de error |
| `--danger-soft`   | `#fdeded` | Fondo de notice/badge de error                         |
| `--danger-border` | `#f0c5c5` | Borde de notice de error                               |
| `--success`       | `#14663a` | Texto de badge activo                                  |
| `--success-soft`  | `#e9f5ed` | Fondo de badge activo                                  |
| `--warning`       | `#8a5a00` | Texto de badge/notice de advertencia                   |
| `--warning-soft`  | `#fdf1d9` | Fondo de badge/notice de advertencia                   |
| `--neutral-soft`  | `#eef1f4` | Fondo de badge inactivo/mudo, hover de nav             |

## Espaciado, radio, sombra, tipografía

- Escala de espaciado en 7 pasos, `--space-1` (0.25rem) a `--space-7` (3rem),
  usada para todo padding/gap/margin del sistema — no hay valores de espaciado
  sueltos fuera de esta escala en `styles.css`.
- Radios: `--radius` (8px, card/stat), `--radius-sm` (6px, input/botón/badge
  cuadrado) y `--radius-pill` (badge/paginación redondeada).
- Sombra en dos niveles: `--shadow-sm` (card en reposo) y `--shadow`
  (elementos flotantes: `.combobox__results`).
- Tipografía: una sola familia de sistema (`--font`), tamaño base 15px,
  `line-height: 1.5`. Jerarquía de encabezado en dos niveles (`h1` 1.5rem/650,
  `h2` 1.125rem/620); no hay `h3` con estilo propio más allá de heredar
  `margin/line-height/letter-spacing` de la regla combinada `h1, h2, h3`.
  `font-variant-numeric: tabular-nums` se aplica a todo número que se compara
  en columna (montos de tabla, `.stat__value`, estado de paginación) para que
  los dígitos alineen.

## Convenciones de componente

Estas son las convenciones que el código ya sigue — usarlas es "seguir el
sistema"; una pantalla nueva que reinventa una de estas en vez de reusarla es
una inconsistencia, no una variación válida.

- **`.card`** — contenedor de superficie elevada (`--surface` + `--border` +
  `--shadow-sm`); `.card__body` da el padding interno (`--space-5`). Toolbar,
  tabla y paginación son secciones dentro de una card, separadas por
  `border-bottom`/`border-top` en vez de por su propia card.
- **`.page-header`** — título + subtítulo + acciones alineadas a la derecha,
  con wrap en pantallas angostas. El subtítulo (`.page-header__subtitle`) usa
  `--text-muted`, nunca `--text-subtle`.
- **`.stat`** — bloque de lectura (no interactivo) sobre `--surface-sunken`:
  `.stat__label` (mayúsculas, `--text-subtle`), `.stat__value` (tabular),
  `.stat__note` opcional (`--text-subtle`).
- **`.badge`** — estado corto en pastilla; variantes `--active`, `--inactive`,
  `--muted`, `--warning`, `--info`, `--danger`, cada una con su par
  color/fondo `-soft` de la paleta de estado. Nunca texto suelto para
  comunicar estado: si algo tiene un estado, es un badge.
- **`.notice`** — mensaje de nivel de página (no de campo); variantes
  `--error`, `--info`, `--warning`. No existe `.notice--success`.
- **`.state`** — bloque centrado de página vacía/error, con `.state__title` y
  `.state__actions` opcional.
- **Tabla** (`.table` dentro de `.table-scroll`) — encabezado en
  `--surface-sunken` con texto `--text-subtle`; `.cell-primary` /
  `.cell-secondary` para la jerarquía dentro de una celda;
  `.table__numeric` para alinear montos a la derecha.
- **Formulario** — `.field` + `.field__label` + `.field__hint` /
  `.field__error`; `.form-grid` de dos columnas que colapsa a una en
  `max-width: 640px`; `.form-actions` alineadas a la derecha con separador
  superior.
- **Botón** — `--primary` (acción principal, una por vista), `--secondary`
  (border, sin relleno) y `--ghost` (sin borde, para acciones de bajo énfasis
  dentro de una fila).
- **`.centered-page`** — página de un solo bloque centrado (hoy solo login).
  `place-items: center` le da ancho automático a su hijo directo, así que
  `.centered-page > * { width: min(100%, 22rem) }` fija ese ancho en la hoja
  de estilos — no en el componente — para que la card no colapse al ancho
  mínimo de su contenido cuando los inputs internos ya son `width: 100%`.

## Accesibilidad de color

### Fix aplicado en este PR: `--text-subtle`

`--text-subtle` pasó de `#82919e` a `#62707d`. El valor anterior no cumplía
AA (4.5:1) contra ninguno de los tres fondos neutros de la app:

| Fondo                          | Valor          | Ratio anterior (`#82919e`) | Ratio nuevo (`#62707d`) |
| ------------------------------ | -------------- | -------------------------: | ----------------------: |
| `--surface` (`#ffffff`)        | blanco         |                     3.23:1 |              **5.08:1** |
| `--surface-sunken` (`#fafbfc`) | casi blanco    |                     3.12:1 |              **4.90:1** |
| `--bg` (`#f5f7f9`)             | gris muy claro |                     3.01:1 |              **4.73:1** |

Ratios calculados con la fórmula de contraste WCAG 2.x (luminancia relativa
sRGB). `--bg` es el fondo más exigente de los tres (el más cercano en
luminancia al texto), y el nuevo valor lo cumple con margen (4.73:1 ≥ 4.5:1).

Se mantiene la jerarquía: `--text` (luminancia 0.014) es más oscuro que
`--text-muted` (0.127), que a su vez es más oscuro que el nuevo
`--text-subtle` (0.157) — sigue siendo el más apagado de los tres, ahora
dentro de AA.

### Selectores verificados (8 usos de `--text-subtle` en `styles.css`)

Se revisó el fondo real de cada uno, no solo los tres tokens de arriba —
ninguno vive dentro de un badge, notice o superficie de color:

| Selector                            | Línea | Fondo real                                                   |
| ----------------------------------- | ----: | ------------------------------------------------------------ |
| `.field__hint`                      |   225 | `--surface` (dentro de `.card__body`)                        |
| `input::placeholder`                |   250 | `--surface` (fondo propio del input habilitado)              |
| `input:disabled`, `select:disabled` |   268 | `--surface-sunken` (el mismo selector fija ese fondo)        |
| `.table thead th`                   |   385 | `--surface-sunken` (el mismo bloque de regla fija ese fondo) |
| `.money--clear`                     |   429 | `--surface`, o `--surface-sunken` en `tbody tr:hover`        |
| `.combobox__empty`                  |   577 | `--surface` (fondo de `.combobox__results`)                  |
| `.stat__label`                      |   671 | `--surface-sunken` (fondo de `.stat`)                        |
| `.stat__note`                       |   686 | `--surface-sunken` (fondo de `.stat`)                        |

Todos resuelven a `--surface` o `--surface-sunken`; ambos quedan cubiertos
por la tabla de ratios de arriba.

## Qué ya cumple (auditoría de `chore/design-baseline`)

La auditoría no encontró otro problema arreglable solo con una variable de
`:root` — todo lo demás que encontró toca componente o marcado y queda en
"Pendiente" abajo. Lo que sí está bien y vale la pena mantener:

- El esqueleto de página con listado paginado (`.page-header` + `.card` >
  `.toolbar` + aviso de carga lenta + estado de error/carga/vacío +
  `.table-scroll` + paginación) se repite idéntico en las 6 pantallas de
  listado (pedidos, clientes, historial de movimientos, producción, conteos
  y las dos sub-listas de `customer-prices-section`) — consistencia real, no
  copia superficial.
- Ningún estado de deuda o badge depende solo del color: toda variante de
  `.badge` lleva texto, y `.money--owed`/`.money--clear` son redundantes con
  el número mostrado.
- `font-variant-numeric: tabular-nums` se aplica sin excepciones a toda
  columna numérica/monto de toda tabla y `.stat`.

## Resuelto: los tres hallazgos no-P3 de la auditoría

Los tres puntos P1/P2 que la auditoría de `chore/design-baseline` había
dejado en "Pendiente" ya están cerrados en el código:

- **Login usa el sistema de diseño.** `pages/login-page.tsx` renderiza
  `<main className="centered-page">` > `<form className="card">` >
  `.card__body` con `.field`/`.field__label` para usuario y contraseña,
  `.notice--error` para el error de credenciales, `SlowRequestNotice` (en vez
  de un `<p role="status">` propio) para el aviso de arranque en frío, y
  `.button.button--primary` en el submit — mismo patrón que
  `customer-form.tsx`. La lógica (validación, `useAuth`, `Navigate` cuando ya
  hay sesión) no cambió, solo el marcado. El ancho de la card lo resuelve
  `.centered-page > *` en `styles.css` (ver la convención de `.centered-page`
  arriba).
- **`container-movements-page.tsx` y `production-page.tsx` envuelven su
  `<h2>` de sección en `.page-header`** — mismo patrón que ya usaba
  `customer-prices-section.tsx` — así que el título tiene el margen inferior
  del sistema en vez de tocar la primera fila del formulario.
- **El negativo de `container-counts-page.tsx` lleva `aria-label`**, con un
  texto propio de esta pantalla (el cliente devolvió más envases de los que
  se le registraron como entregados) — no el mismo texto que
  `inventory-page.tsx`, que describe un negativo distinto (más envases
  llenados que vacíos registrados en planta). Un comentario en el código
  marca por qué los dos textos no son intercambiables.

## Pendiente (no entra en este PR) — solo quedan hallazgos P3

Criterio de esta lista: todo lo que requiere tocar un componente, marcado o
clase queda acá para decidirse aparte, en vez de entrar en un PR de solo
`:root`. Orden por severidad.

1. **[P3] `.page-header__subtitle` usado como utilidad de texto muted** —
   se repite en `container-movements-page.tsx:482`,
   `container-counts-page.tsx:170,235`, `inventory-page.tsx:120` y
   `dashboard-page.tsx:12-15,25-27` (esta última fuera de alcance para
   tocar en esta rama). No existe una clase `.text-muted` genérica, así que
   estas pantallas reusan una clase pensada para el subtítulo de
   `.page-header` fuera de ese contexto. Es el único patrón que se repite en
   3+ archivos. _Categoría: consistencia, tipografía. Requiere: crear
   `.text-muted` y migrar estos usos._

2. **[P3] `.field__hint` sin campo asociado** —
   `components/order-items-form.tsx:246`. Es un mensaje instructivo suelto
   ("Elige un cliente para ver sus precios"), no un hint de un input
   específico, que es como se usa `.field__hint` en el resto del código.
   _Categoría: consistencia, tipografía. Requiere: usar `.notice--info` o un
   párrafo muted en vez de `.field__hint`._

3. **[P3] Error de fila lejos de la fila** —
   `pages/container-types-page.tsx` y
   `components/customer-prices-section.tsx`: los errores de renombrar/dar de
   baja/editar se muestran una sola vez arriba de la card, no junto a la fila
   que se está editando. No es un problema hoy con catálogos cortos, pero no
   escala. _Categoría: estados. Requiere: mostrar el error junto a la fila._
