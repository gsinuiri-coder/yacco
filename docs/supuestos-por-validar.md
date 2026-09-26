# Supuestos por validar con el dueño de la planta

Decisiones de producto que se tomaron **entre Giancarlo y la capa
arquitectónica**, sin preguntárselas al dueño de la planta, y sobre las que ya
hay código construido.

No son deuda técnica —para eso está [`backlog-tecnico.md`](./backlog-tecnico.md)—
ni requisitos: son **preguntas pendientes**. Este archivo existe para que el día
de la demo haya una lista que leer, y no haya que reconstruirla de memoria.

## Cómo se usa

Cada supuesto tiene siempre las mismas cuatro líneas. En la demo alcanza con
leer las **Preguntar**; las otras tres son para saber qué está en juego antes de
escuchar la respuesta.

- **Asumimos** — la afirmación sobre lo que el dueño necesita, prefiere o hace.
- **Construido encima** — qué código depende de que sea cierta.
- **Preguntar** — la pregunta, en el vocabulario de la planta, sin insinuar la
  respuesta que nos conviene.
- **Si dice que no** — qué cambia. Sirve para saber si la pregunta es barata o
  cara antes de hacerla.

Cuando uno se valida, se mueve a **Validados** al final, con la fecha y lo que
dijo. Cuando se cae, se borra de acá y se abre lo que corresponda en
`backlog-tecnico.md`. Un supuesto no se queda en esta lista después de tener
respuesta.

**Una decisión puede aterrizar en Validados sin haber pasado nunca por
Pendientes.** Pasa cada vez que el dueño resuelve algo que nadie llegó a anotar
como supuesto —porque la pregunta apareció y se le hizo en el mismo día, o
porque el tema se descubrió ya con él delante—. Esas entradas se escriben
directamente abajo; no se inventa un pendiente retroactivo para que el
documento parezca más prolijo de lo que fue.

Cada entrada validada lleva, además de la fecha, una línea **Cómo se resolvió**
con uno de dos valores, y la diferencia importa:

- **Respondió la pregunta** — se le preguntó en el vocabulario de la planta, sin
  insinuar la respuesta que nos convenía, y eligió.
- **Aprobó la recomendación** — le llevamos una propuesta razonada, con lo que
  implicaba, y dijo que sí.

Las dos son decisiones suyas y ninguna vale menos, pero no son lo mismo: el día
que diga otra cosa, el documento tiene que poder mostrar cuál de las dos fue —si
eligió entre opciones o si aceptó la nuestra.

Las entradas validadas tienen tres líneas:

- **Qué se decidió** — la decisión, en una frase, con lo que quedó explícitamente
  afuera.
- **Cómo se resolvió** — uno de los dos valores de arriba.
- **Construido encima** — qué código la implementa, o que todavía no hay ninguno.

**Regla para escribir código nuevo:** si una decisión de producto se toma sin
preguntarle, se anota en **Pendientes** (si se le va a preguntar) o en
**Decididos sin el dueño** (si se tomó en un trabajo autónomo, sin reunión
posible), y el comentario del código dice que es un supuesto.
Lo que no se puede es escribirla como si él la hubiera pedido — el día que
diga otra cosa, el documento tiene que mostrar que nunca se lo preguntamos, no
que dijo que sí.

## Pendientes

Ninguno. Los veinte supuestos que estaban acá (decididos por delegación entre
el 2026-09-24 y el 2026-09-25) se le llevaron al dueño el 2026-09-25 con su
recomendación y los aprobó: bajaron a **Validados**, numerados igual que
antes para que los enlaces de `guion-piloto.md` sigan valiendo.

Un supuesto nuevo se escribe acá con las cuatro líneas de «Cómo se usa», más
una primera línea que dice quién lo decidió y cuándo.

## Decididos sin el dueño

Decisiones de dominio que se tomaron **sin preguntarle**, en un trabajo
autónomo donde no había reunión posible. No son respuestas suyas ni preguntas
agendadas: por eso no llevan **Preguntar** y no están en Pendientes. El día
que diga otra cosa, la línea **Si resulta que no** (el equivalente de «Si dice
que no») dice cuánto cuesta cambiarlas. Si después se le preguntan y contesta,
bajan a Validados como cualquier otra. Cada una lleva quién la decidió y
cuándo, y tres líneas:

- **Asumimos** — lo que se da por cierto de la operación de la planta.
- **Construido encima** — qué código depende de eso.
- **Si resulta que no** — qué cambia, y si es barato o caro.

## Validados

### 1. El buscador del Panel muestra clientes desactivados — 25/09/2026

- **Qué se decidió:** el buscador de la pantalla de inicio trae también a los
  clientes dados de baja, porque el que se dio de baja y todavía debe es a
  quien se busca para cobrarle. Quedó afuera filtrarlo solo a los activos.
- **Cómo se resolvió:** aprobó la recomendación.
- **Construido encima:** `apps/web-nuxt/app/components/CustomerQuickSearch.vue`,
  sin el filtro `active` que sí aplica `CustomerPicker.vue`.

### 2. Al cambiar una contraseña, el administrador la elige y la dicta — 25/09/2026

- **Qué se decidió:** cuando a alguien se le olvida la contraseña, el
  administrador le pone una y se la dicta. Quedaron afuera la contraseña
  provisional que la persona cambia al entrar y la pantalla de «cambiar mi
  contraseña».
- **Cómo se resolvió:** aprobó la recomendación.
- **Construido encima:** el bloque «Cambiar contraseña» de
  `apps/web-nuxt/app/pages/users.vue`.

### 3. El administrador puede cambiarse la contraseña a sí mismo — 25/09/2026

- **Qué se decidió:** el administrador se cambia la suya desde «Usuarios», en
  su propia fila, y es la forma de rotar la contraseña inicial. Quedó afuera
  aplicarle a «Cambiar contraseña» la guarda de «es uno mismo» que tiene
  «Desactivar».
- **Cómo se resolvió:** aprobó la recomendación.
- **Construido encima:** `users.vue`, que ofrece «Cambiar contraseña» también
  en la fila propia.

### 4. Quien es desactivado, o a quien se le cambia la contraseña, queda afuera a lo sumo en 15 minutos — 25/09/2026

- **Qué se decidió:** alcanza con que la persona quede afuera a lo sumo 15
  minutos después de desactivarla o de cambiarle la contraseña, también el
  administrador que se cambia la suya. Quedó afuera sacarla en el acto.
- **Cómo se resolvió:** aprobó la recomendación.
- **Construido encima:** `users.token_version` (D-024) y los tests «resetting
  a user's password invalidates a refresh token already issued» y «a user
  deactivated after issuing a refresh token loses access on refresh» de
  `apps/api/test/integration/auth.int.test.ts`.

### 5. Quitarle el rol de chofer a alguien avisa, pero no bloquea — 25/09/2026

- **Qué se decidió:** si el administrador le quita «Chofer» a alguien con
  rutas sin cerrar, el sistema le dice cuántas y lo deja decidir. Quedó afuera
  impedirlo hasta que las rutas se cierren.
- **Cómo se resolvió:** aprobó la recomendación.
- **Construido encima:** el bloque «Roles» de `apps/web-nuxt/app/pages/users.vue`.

### 6. Las rutas conservan al chofer que las hizo — 25/09/2026

- **Qué se decidió:** la ruta sigue a nombre de quien salió con ella aunque
  después deje de ser chofer; la oficina la termina y la liquida igual. Quedó
  afuera reasignar una ruta a otro chofer.
- **Cómo se resolvió:** aprobó la recomendación.
- **Construido encima:** el cambio de roles no toca `routes`;
  `assertCanAccessRoute` deja a ADMIN y SELLER terminar cualquier ruta.

### 7. El cliente devuelve los vacíos en la visita siguiente, no en el momento — 25/09/2026

- **Qué se decidió:** la demo sigue mostrando que el chofer se lleva los vacíos
  de la visita anterior, con un descuadre de ejemplo. Quedó afuera cambiar las
  cantidades del plan de la demo. No toca el sistema real.
- **Cómo se resolvió:** aprobó la recomendación.
- **Construido encima:** el plan de `seed-demo-plan.ts`.

### 8. El administrador que corrige una parada queda como quien autorizó el precio — 25/09/2026

- **Qué se decidió:** en una corrección alcanza con el nombre de quien corrige
  y el motivo; quien corrige queda como el que autorizó el precio de esa venta.
  Quedó afuera un campo aparte para decir quién autorizó cobrar distinto de lo
  pactado.
- **Cómo se resolvió:** aprobó la recomendación.
- **Construido encima:** `RoutesService.correctStop`, que manda
  `priceOverrideAuthorizedById: actor.id` siempre, y el 400 a un
  `priceOverrideAuthorizedById` que venga en el cuerpo.

### 9. La parada muestra solo la última corrección, no todas — 25/09/2026

- **Qué se decidió:** la visita muestra la última corrección con su motivo.
  Cuando la visita tenía una venta, la anterior queda anulada con su motivo y
  el libro de envases guarda todo; si la visita había quedado como no
  entregada, el motivo de la primera corrección se reemplaza con el de la
  segunda. Quedó afuera la lista de todas las correcciones (una tabla nueva).
- **Cómo se resolvió:** aprobó la recomendación.
- **Construido encima:** `corrected_at` / `corrected_by` / `correction_reason`
  de `route_stops`, que una segunda corrección pisa.

### 10. Corregir hacia arriba deja el camión en negativo en vez de frenar — 25/09/2026

- **Qué se decidió:** si al corregir una visita se entregaron más bidones de
  los que figuraban cargados, la corrección se anota igual y avisa que el
  camión queda en negativo. Quedó afuera frenarla hasta arreglar la carga. Una
  entrega normal sigue sin poder entregar lo que el camión no tiene.
- **Cómo se resolvió:** aprobó la recomendación.
- **Construido encima:** `allowStockShortfall` en
  `SalesService.registerStopDeliveryWithinTransaction`, que solo prende
  `RoutesService.correctStop`, y el aviso de `RouteMarkOutcome.vue`.

### 11. Los llenos que vuelven reponen el lote más antiguo del que salieron — 25/09/2026

- **Qué se decidió:** los bidones llenos que vuelven sin entregar entran otra
  vez al stock para cargar mañana, reponiendo primero el lote más viejo de los
  que cargó esa ruta. Quedaron afuera un estado «en revisión» y la baja por
  fecha de lote.
- **Cómo se resolvió:** aprobó la recomendación.
- **Construido encima:** `RouteSettlementService.returnFullsToPlant`.

### 12. El chofer registra sus paradas en el celular, en línea y sin cambiar precios — 25/09/2026

- **Qué se decidió:** el chofer usa el mismo web en el celular, con internet
  («Mi ruta»), y cobra siempre el precio pactado; si el cliente paga distinto,
  lo arregla la oficina. Quedaron afuera que el chofer registre sin señal y
  que cambie precios.
- **Cómo se resolvió:** aprobó la recomendación.
- **Construido encima:** la página `/my-route`, el menú reducido del Chofer y
  la lectura por recurso de `common/viewer.ts`. Sobre esta aprobación, el
  cierre final (ítem B, 2026-09-26, por decisión de Giancarlo) dejó la app sin
  conexión y la sincronización fuera del alcance en la spec (§1.3, §4.2, §4.3)
  y en `AGENTS.md`; el diseño se conserva en
  `.agents/skills/sync-protocol/SKILL.md`.

### 13. «Debe desde» es el cargo que abrió la deuda actual — 25/09/2026

- **Qué se decidió:** «Debe desde» es la fecha en que el cliente dejó de estar
  al día. Quedó afuera la fecha de la venta más vieja impaga, que exigiría
  repartir cada cobro entre ventas.
- **Cómo se resolvió:** aprobó la recomendación.
- **Construido encima:** `replayDebt` en
  `apps/api/src/modules/reports/reports.service.ts` y la columna «Debe desde»
  de `apps/web-nuxt/app/pages/reports/debt.vue`, con «Saldo inicial» y su fecha
  cuando la deuda abre en el padrón.

### 14. El padrón del sistema viejo entra entero, sin zona y sin envases — 25/09/2026

- **Qué se decidió:** la deuda del sistema viejo es la vigente y entra tal
  cual; los teléfonos repetidos son de relleno, no clientes duplicados; los
  bidones de cada cliente se cuentan en la calle. Quedaron afuera tratar los
  teléfonos repetidos como clientes duplicados y traer envases del sistema
  viejo (no los tenía).
- **Cómo se resolvió:** aprobó la recomendación.
- **Construido encima:** `tools/firestore-export/src/to-roster.ts`,
  `pnpm load:roster` y la carga en `main` del 2026-09-24.

### El cliente con casi toda la deuda — 25/09/2026

- **Qué se decidió:** la deuda del cliente que tiene cerca del 92 % del total
  del padrón es real y vigente: no se toca, y el cliente sigue sin zona.
- **Cómo se resolvió:** respondió la pregunta (operativa, sin recomendación).
- **Construido encima:** nada nuevo; su saldo inicial del padrón queda como
  entró.

### 15. Nadie de la planta tiene una cuenta para mirar sin tocar — 25/09/2026

- **Qué se decidió:** en el piloto nadie tiene una cuenta solo para mirar;
  `VIEWER` sigue siendo la cuenta técnica del smoke. Quedó afuera un rol de
  solo lectura para personas.
- **Cómo se resolvió:** aprobó la recomendación.
- **Construido encima:** el enum `user_role` con `VIEWER`,
  `scripts/viewer-bootstrap.mjs` y `checkViewerSession` de `scripts/smoke.mjs`.

### 16. Las etiquetas de lugar del sistema viejo son las zonas de reparto — 25/09/2026

- **Qué se decidió:** una etiqueta es zona si nombra un lugar. Parque, Surco y
  **Casas Parque, que es zona aparte** de Parque. **EMPRESAS, DISTRIBUIDOR,
  HERMES y BIOZON no son zonas**: sus clientes quedan sin zona. Quedó afuera
  juntar Casas Parque con Parque. Los días de reparto de cada zona se ponen en
  «Zonas».
- **Cómo se resolvió:** aprobó la recomendación.
- **Construido encima:** `scripts/roster-zones.mjs`, su mapeo
  `scripts/roster-zones-labels.json` y las tres zonas de `main`.

### 17. Un pedido se cobra al precio del día en que se entrega — 25/09/2026

- **Qué se decidió:** se cobra el precio vigente el día de la entrega, también
  en un pedido tomado antes del cambio. Quedó afuera respetar el precio del día
  del pedido.
- **Cómo se resolvió:** aprobó la recomendación.
- **Construido encima:** `SalesService.registerStopDeliveryWithinTransaction`
  y el texto de ayuda de `apps/web-nuxt/app/pages/products.vue`.

### 18. Un cobro rechazado después de liquidar no reabre la liquidación — 25/09/2026

- **Qué se decidió:** la liquidación queda como se cerró, con el aviso de que
  un cobro se cayó, y ese monto se le cobra al cliente, donde queda como deuda.
  Quedó afuera reabrir la liquidación.
- **Cómo se resolvió:** aprobó la recomendación.
- **Construido encima:** `RouteSettlementService.getSettlementView`,
  `moneyDrifted` y el aviso de `apps/web-nuxt/app/pages/routes/[id]/settlement.vue`.

### 19. Registrar un lote sin vacíos suficientes avisa y no bloquea — 25/09/2026

- **Qué se decidió:** el lote se registra y el sistema avisa, con las dos
  cantidades por tipo de envase, que llenó más de los vacíos que figuraban en
  la planta (quedan en negativo). Quedaron afuera el paso de confirmación antes
  de guardar y el bloqueo. HU-01 E2 dice esto desde el ítem B del cierre final
  (2026-09-26); antes decía «antes de confirmar».
- **Cómo se resolvió:** aprobó la recomendación.
- **Construido encima:** `ProductionBatchesService.create` y el aviso de
  `apps/web-nuxt/app/pages/production.vue`.

### 20. Quien anota los conteos en la oficina ve los saldos de envases de los clientes — 25/09/2026

- **Qué se decidió:** el Vendedor ve «Envases en poder de clientes» y la
  sección «Envases» de la ficha, igual que el administrador. Quedó afuera
  dejárselo solo al administrador.
- **Cómo se resolvió:** aprobó la recomendación.
- **Construido encima:** los `@Roles(ADMIN, SELLER)` de
  `container-balances.controller.ts` y `CustomerContainersSection.vue`.

### Terminar una ruta exige sus paradas resueltas — 29/08/2026

- **Qué se decidió:** una ruta no puede terminarse mientras le quede una parada
  sin resolver; hay que marcar cada una como entregada o no entregada, o
  quitarla de la ruta. Se descartaron las dos alternativas: **no** se
  autocompletan las paradas al terminar (sería inventar un hecho de campo que
  nadie observó) y **no** se liberan los pedidos de las paradas pendientes
  (sería devolverlos a la bandeja como si nunca hubieran salido en un camión).
  Una ruta que nunca tuvo paradas sí se puede terminar.
- **Cómo se resolvió:** aprobó la recomendación. Se le llevó el caso —un pedido
  que queda «en ruta» para siempre porque su parada quedó a medias— con la
  propuesta de no dejar cerrar la ruta hasta resolverlas, y dijo que sí.
- **Construido encima:** el PR «terminar una ruta exige que sus paradas estén
  resueltas»: la guarda dentro del `WHERE` de `RoutesService.finish`, el 409 con
  el número de paradas que faltan, y el diálogo de «Terminar ruta» de la
  pantalla de detalle, que dejó de ofrecer confirmar cuando quedan paradas. El
  detalle de por qué este bloqueo no contradice el «avisa, no bloquea» del
  sistema está en «Terminar una ruta no exigía sus paradas resueltas», en
  [`backlog-tecnico.md`](./backlog-tecnico.md).

### La liquidación emite los `EMPTY_UNLOAD` que devuelven los vacíos al galpón — 29/08/2026

- **Qué se decidió:** al liquidar una ruta, los vacíos contados en la puerta
  vuelven al galpón con su movimiento `EMPTY_UNLOAD`, en vez de quedarse en
  `EMPTY_ON_ROUTE` para siempre. Cuatro cosas quedaron fijadas con la decisión:
  `emptiesCollected` deja de ser un entero y pasa a ser un **desglose por tipo
  de envase**, porque un movimiento de envases nombra siempre su tipo; el
  movimiento se emite **desde lo contado** en la puerta, no desde lo que dice el
  libro, que es justo el número contra el que se cuenta; es **automático dentro
  de `settle`** y no un paso aparte, porque descargar el camión no es una
  decisión que alguien tome cada tarde; y **no lleva migración** —
  `empties_collected` sigue guardando el total y el desglose se reconstruye del
  ledger, que es la fuente de verdad. `fullReturned` queda explícitamente
  **afuera**: los llenos que vuelven son otra conversación, y meterla acá
  duplicaría el alcance.
- **Cómo se resolvió:** aprobó la recomendación. Se le mostró el inventario de
  la demo abriendo con 34 «Con caño» en camión —envases que en la planta real
  vuelven al galpón el mismo día— con la propuesta de emitirlos desde la
  liquidación, y dijo que sí.
- **Construido encima:** el PR «la liquidación devuelve los vacíos al galpón»,
  que cerró «Descargar los vacíos al volver de ruta no tiene camino en la app»
  en [`backlog-tecnico.md`](./backlog-tecnico.md): `settle` emite un
  `EMPTY_UNLOAD` por cada tipo contado, `emptiesCollected` viaja desglosado por
  tipo, la pantalla de liquidación cuenta línea por línea y el seed de demo
  liquida todas sus rutas menos la última. `fullReturned` quedó afuera, con su
  propia entrada abierta en el backlog.
