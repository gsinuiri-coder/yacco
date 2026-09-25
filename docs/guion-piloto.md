# Guion de la reunión con el dueño — piloto

Para leer en voz alta con el dueño de la planta. Cada pregunta trae las cuatro
líneas de su supuesto (copiadas de [`supuestos-por-validar.md`](./supuestos-por-validar.md))
y una quinta, **«Si pregunta qué haríamos nosotros»**, con la recomendación
que ya tomamos por delegación. **Se lee la línea «Preguntar» y se escucha.** La
recomendación se dice solo si él la pide: la pregunta va sin insinuar la
respuesta que nos conviene.

Ningún nombre, teléfono ni monto de una persona en este documento. Si el dueño
pregunta por un cliente puntual, se busca en la pantalla, no acá.

Al final está la hoja de cierre: una fila por pregunta para marcar qué pasó.

## 1. El padrón y la deuda

_Del supuesto 14 se leen acá solo las dos primeras preguntas (la deuda y los
teléfonos repetidos). Las etiquetas y los bidones se preguntan en las
secciones 2 y 3._

#### Supuesto 14. El padrón del sistema viejo entra entero, sin zona y sin envases

- **Asumimos:** que `debtAmount` del sistema viejo es la deuda vigente de cada
  cliente, y que los 192 clientes que comparten 25 teléfonos son clientes
  distintos con un teléfono de relleno, no duplicados.
- **Construido encima:** `tools/firestore-export/src/to-roster.ts` (del
  export a los 4 CSV de `pnpm load:roster`) y la corrida en DEMO descrita en
  `docs/padron-corrida-demo.md`.
- **Preguntar:** ¿la deuda que muestra el sistema viejo es la que usted cobra
  hoy? ¿Esos teléfonos repetidos son de relleno? ¿Qué etiquetas son zonas de
  reparto y cuáles no? ¿Cuántos bidones tiene cada cliente, o hay que
  contarlos?
- **Si dice que no:** barato si es la zona (se asigna desde la ficha del
  cliente, o con `pnpm roster:zones`, que solo toca la zona). **No** se
  recarga con `pnpm load:roster`: su `upsert` vuelve a escribir nombre y
  teléfono desde el CSV y pisaría lo que se corrigió en la app. Caro si la
  deuda no es la vigente: se corrige con movimientos inversos, cliente por
  cliente, nunca editando la carga.
- **Si pregunta qué haríamos nosotros:** recomendamos tomar la deuda del sistema viejo tal cual, tratar los teléfonos repetidos como relleno (no como clientes duplicados), y contar los bidones en la calle.

#### Supuesto 13. «Debe desde» es el cargo que abrió la deuda actual

- **Asumimos:** que al dueño le sirve saber desde cuándo un cliente no está al
  día, y no cuál venta puntual sigue impaga. El sistema no reparte cobros entre
  ventas (ver «Reparto de un pago global entre deudas del cliente» en
  `backlog-tecnico.md`), así que esta es la fecha más antigua que se puede
  defender sin inventar ese reparto. Si el cliente paga algo pero nunca llega a
  cero, la fecha no se mueve.
- **Construido encima:** `replayDebt` en
  `apps/api/src/modules/reports/reports.service.ts` y la columna «Debe desde»
  de `apps/web-nuxt/app/pages/reports/debt.vue`. El día es el de Lima.
- **Preguntar:** cuando un cliente le va pagando de a poco, ¿quiere ver desde
  cuándo no está al día, o la fecha de la venta más vieja que todavía no pagó?
- **Si dice que no:** medio. «La venta más vieja impaga» exige decidir primero
  cómo se reparte un cobro entre ventas (la más antigua primero es lo usual) y
  aplicarlo igual en todas partes; el cálculo del reporte cambia, la pantalla
  no.
- **Si pregunta qué haríamos nosotros:** recomendamos mostrar «Debe desde» como la fecha en que el cliente dejó de estar al día, que es lo que se puede afirmar sin inventar a qué venta se aplicó cada pago.

#### Los precios de lista (pregunta operativa)

- **Hoy:** los precios de lista son provisionales (S/ 8.00 la recarga,
  S/ 30.00 el bidón con caño, S/ 28.00 el bidón sin caño). Se cambian en
  «Productos» (Administración), solo el administrador.
- **Preguntar:** ¿cuánto cobra hoy la recarga de 20 litros, y cuánto el bidón
  nuevo, con caño y sin caño, a un cliente que no tiene un precio especial?
- **Qué hacemos con la respuesta:** los pone él (o la oficina, con él al lado)
  en «Productos» en ese momento. Los clientes con precio especial se cargan
  en su ficha, en «Precios pactados».

#### Supuesto 17. Un pedido se cobra al precio del día en que se entrega

- **Asumimos:** que un cambio de precio en la planta vale desde que se anuncia
  para todo lo que sale en el camión, y que el cliente no espera que le
  respeten el precio viejo por haber pedido antes.
- **Construido encima:** `SalesService.registerStopDeliveryWithinTransaction`
  resuelve el precio al registrar la entrega (precio de la ubicación, del
  cliente, y si no hay, el de lista de ese momento); el formulario de parada
  no lleva el precio del pedido. El texto de ayuda de
  `apps/web-nuxt/app/pages/products.vue`.
- **Preguntar:** si un cliente hizo un pedido el lunes y el martes usted sube
  el precio de la recarga, cuando el chofer se lo entrega el miércoles, ¿le
  cobra el precio del lunes o el nuevo?
- **Si dice que no:** medio. El formulario de parada tendría que traer el
  `unitPrice` de la línea del pedido en vez de dejarlo en blanco, y decidir
  qué pasa con un pedido que lleva un producto sin precio en su línea. No
  toca esquema: el precio ya está guardado en `order_items`.
- **Si pregunta qué haríamos nosotros:** recomendamos cobrar el precio del día en que se entrega, igual para todos, también en pedidos que se tomaron antes del cambio.

## 2. Los envases

#### Supuesto 7. El cliente devuelve los vacíos en la visita siguiente, no en el momento

- **Asumimos** que el ciclo normal es: el chofer deja llenos hoy y se lleva los
  vacíos de la visita anterior, así que un cliente habitual queda con más o
  menos una visita de envases en la mano. También asumimos que un saldo
  negativo es raro y viene del cuaderno de papel —envases entregados que nadie
  anotó— y no de la operación de todos los días.
- **Construido encima:** el plan de `seed-demo-plan.ts`. De nueve visitas con
  devolución, ocho devuelven lo de la visita anterior y una devuelve de más,
  que es el descuadre que la pantalla de cuadre necesita mostrar. Esa
  proporción es la que enseña, a quien mire la demo, qué es normal y qué es
  excepción.
- **Preguntar:** cuando su chofer llega a un cliente, ¿se trae los envases
  vacíos de la vez pasada, o el cliente se los va guardando y se los entrega
  cada tanto? ¿Cuántos envases suele tener un cliente habitual en la mano?
- **Si dice que no:** barato, y solo toca la demo. Si los clientes acumulan
  varias visitas antes de devolver, cambian las cantidades del plan y los
  saldos quedan más altos; el descuadre se sigue produciendo igual. Nada de
  esto toca el código de producción.
- **Si pregunta qué haríamos nosotros:** recomendamos dejar la demo como está (el chofer se lleva los vacíos de la visita anterior) y ajustar las cantidades si usted nos dice otra costumbre. No cambia nada del sistema real.

#### Supuesto 11. Los llenos que vuelven reponen el lote más antiguo del que salieron

- **Asumimos:** que en el galpón un lleno que vuelve se vuelve a cargar en la
  próxima ruta como cualquier otro, y que al dueño no le importa de qué lote
  exacto era ese bidón mientras el lote más viejo se use primero.
- **Construido encima:** `RouteSettlementService.returnFullsToPlant`: un
  `FULL_RETURN` por lote repuesto y el `available_qty` de ese lote, en la misma
  transacción de la liquidación. El origen de cada carga ya estaba en
  `route_loads`: no hizo falta columna nueva.
- **Preguntar:** cuando el chofer vuelve con bidones llenos que no entregó,
  ¿esos bidones vuelven al stock para cargar mañana, o se tratan aparte (por
  ejemplo, se revisan o se descartan por la fecha del lote)?
- **Si dice que no:** medio. Si se revisan antes de volver al stock, hace falta
  un estado intermedio (lleno en revisión) y una operación para liberarlo; el
  movimiento de la liquidación dejaría de reponer el lote directamente. Si se
  descartan, el retorno sería una baja por daño y no un `FULL_RETURN`.
- **Si pregunta qué haríamos nosotros:** recomendamos que los bidones llenos que vuelven entren otra vez al stock para cargar mañana, reponiendo primero el lote más viejo.

#### ¿Usted sabe cuántos bidones tiene cada cliente, o hay que ir a contarlos? (pregunta operativa)

- **Hoy:** los 604 clientes entraron sin envases (el sistema viejo no tenía
  saldos). Cada ubicación figura «Sin contar» en «Envases en poder de
  clientes».
- **Preguntar:** ¿usted sabe cuántos bidones tiene cada cliente, o hay que ir
  a contarlos?
- **Si hay que contarlos:** el chofer cuenta en cada visita y la oficina lo
  anota en «Envases en poder de clientes» (se busca al cliente por nombre o
  teléfono, o se recorre por zona). Arriba se ve cuántos faltan. No hace falta
  nada más.
- **Si los sabe de antemano (una planilla):** se anotan igual, uno por uno,
  como un conteo con la cantidad que él da; el cliente queda como contado y
  no hay que volver a contarlo. **No se recarga el padrón** para esto: pisaría
  los nombres, teléfonos y zonas que ya se corrigieron (detalle en
  `docs/DEPLOY.md`, «Saldos de envases de los clientes»).

## 3. Las zonas

#### Supuesto 16. Las etiquetas de lugar del sistema viejo son las zonas de reparto

- **Asumimos:** que el dueño organiza el reparto por lugar y que las
  etiquetas de lugar del sistema viejo son las mismas zonas con las que
  piensa sus recorridos; y que un cliente con dos lugares está en el primero.
- **Construido encima:** `scripts/roster-zones.mjs` y su mapeo; las zonas que
  cree en `main`, y el `zone_id` de los clientes que asigne. No toca ningún
  otro dato del cliente.
- **Preguntar:** estas son las etiquetas del sistema viejo y a qué zona
  llevamos cada una: ¿así reparte usted? ¿Hay etiquetas que juntaría en una
  sola zona, o zonas que le faltan? ¿Qué días va a cada zona?
- **Si dice que no:** barato. Una zona se renombra o se retira en «Zonas», y
  un cliente se cambia de zona desde su ficha; nada de eso toca deudas ni
  envases.
- **Si pregunta qué haríamos nosotros:** recomendamos que las etiquetas que nombran un lugar sean las zonas de reparto, y que las de tipo de cliente (EMPRESAS, DISTRIBUIDOR) no lo sean. Los días de cada zona los pone usted.

#### Las etiquetas del sistema viejo y a qué zona van

Del export de solo lectura del sistema viejo (dry-run de `pnpm roster:zones`
contra el padrón de `main`, 2026-09-25). Ningún cliente tiene más de una
etiqueta.

| Etiqueta del sistema viejo | Clientes | La tomamos como zona   | Zona         |
| -------------------------- | -------: | ---------------------- | ------------ |
| PARQUE                     |      476 | Sí                     | Parque       |
| SURCO                      |       58 | Sí                     | Surco        |
| CASAS PARQUE               |        3 | Sí (aparte de Parque)  | Casas Parque |
| EMPRESAS                   |       59 | No (tipo de cliente)   | —            |
| DISTRIBUIDOR               |        4 | No (tipo de cliente)   | —            |
| HERMES                     |        3 | No (nombre de negocio) | —            |
| BIOZON                     |        1 | No (nombre de negocio) | —            |

Quedan con zona 537 clientes y sin zona 67, todos con una etiqueta que no es
lugar. Para él: ¿Casas Parque es parte de Parque o se reparte
aparte? ¿Dónde reparte a las empresas y distribuidores? HERMES y BIOZON las tomamos como
nombres de negocio: ¿es así, o alguna es un lugar?

Esta tabla es la que se le muestra al leer la pregunta del supuesto 16: no hay
una pregunta aparte.

#### Los días de reparto de cada zona (pregunta operativa)

- **Hoy:** las zonas se crean sin días de reparto.
- **Preguntar:** ¿qué días va el camión a cada zona?
- **Qué hacemos con la respuesta:** se ponen en «Zonas» (Administración),
  zona por zona.

## 4. El chofer y la ruta

#### Supuesto 12. El chofer registra sus paradas en el celular, en línea y sin cambiar precios

- **Asumimos:** que en la zona del piloto el chofer tiene señal suficiente
  para registrar cada parada en el momento, y que un precio distinto del
  pactado es una excepción que puede esperar a la oficina.
- **Construido encima:** la página `/my-route` del web, el menú reducido para
  quien solo tiene el rol Chofer, y la apertura de lectura por recurso en
  `OrdersService.findOne` y `CustomerPricesService.findEffectivePrices`
  (`common/viewer.ts`).
- **Preguntar:** ¿sus choferes tienen señal en todo el recorrido? Cuando un
  cliente paga distinto de lo pactado, ¿el chofer lo decide ahí o lo tiene
  que llamar a usted?
- **Si dice que no:** sin señal, es caro: es el módulo de sincronización
  entero (diseño en `.agents/rules/sync-protocol.md`), que hoy no existe. Si
  el chofer tiene que poder cambiar el precio, es barato: mostrarle el campo
  de precio y resolver quién autoriza (hoy la lista de usuarios es solo de la
  oficina).
- **Si pregunta qué haríamos nosotros:** recomendamos que el chofer use el celular con internet y cobre siempre el precio pactado; si el cliente paga distinto, lo arregla la oficina.

#### Supuesto 5. Quitarle el rol de chofer a alguien avisa, pero no bloquea

- **Asumimos:** que si el administrador le quita «Chofer» a alguien que todavía
  tiene rutas sin cerrar, corresponde **avisarle cuántas** y dejarlo decidir, en
  vez de impedírselo hasta que las cierre.
- **Construido encima:** el bloque «Roles» de `apps/web-nuxt/app/pages/users.vue`
  consulta las rutas `PLANNED` e `IN_PROGRESS` de esa persona y pide
  confirmación diciendo el número. Si la consulta falla, se confirma igual
  diciendo que no se pudo verificar. Es coherente con la filosofía del resto del
  sistema —el límite de crédito advierte y no bloquea, una liquidación con
  descuadre cierra igual—, pero eso es una inferencia nuestra, no algo que él
  haya dicho de este caso.
- **Preguntar:** si le saca el permiso de repartir a alguien que todavía tiene
  reparto pendiente, ¿quiere que el sistema se lo deje hacer avisándole, o
  prefiere que no lo deje hasta que esas rutas estén cerradas?
- **Si dice que no:** barato en la pantalla —el botón de confirmar se
  deshabilita en vez de guardar— pero hay que decidir antes qué pasa si la
  consulta de rutas falla: bloquear por no poder verificar deja al
  administrador sin poder corregir un rol por un problema de red.
- **Si pregunta qué haríamos nosotros:** recomendamos que el sistema le avise cuántas rutas pendientes tiene esa persona y lo deje decidir a usted, igual que con el límite de crédito: avisa, no bloquea.

#### Supuesto 6. Las rutas conservan al chofer que las hizo

- **Asumimos:** que al quitarle el rol de chofer a alguien, sus rutas ya
  planificadas o en curso **siguen a su nombre**, sin reasignarse ni cancelarse.
- **Construido encima:** el cambio de roles no toca `routes` en absoluto.
  Descansa en que `route.driverId` es un hecho histórico y en que ADMIN y SELLER
  pueden terminar cualquier ruta desde la oficina
  (`assertCanAccessRoute`), así que ninguna queda trabada.
- **Preguntar:** cuando alguien deja de repartir, ¿la ruta que ya salió a su
  nombre tiene que seguir figurando como suya, o prefiere pasársela a otro
  chofer?
- **Si dice que no:** caro, y toca dominio. Reasignar una ruta cerrada o en
  curso significa decidir qué pasa con lo ya entregado y cobrado en esa ruta, y
  con la liquidación pendiente. No es un campo editable: es una operación con su
  propia forma, y probablemente su propia entrada de backlog.
- **Si pregunta qué haríamos nosotros:** recomendamos que la ruta siga a nombre de quien salió con ella: es lo que pasó. La oficina la puede terminar y liquidar igual.

#### Los choferes y quién trabaja en la oficina (pregunta operativa)

- **Hoy:** en el sistema no hay ningún usuario real, fuera del administrador.
- **Preguntar:** ¿quiénes van a repartir? ¿Quién va a anotar en la oficina
  (pedidos, rutas, cobros)? ¿Alguien hace las dos cosas?
- **Qué hacemos con la respuesta:** se crean en «Usuarios» con su rol: Chofer
  para quien reparte, Vendedor para la oficina, Administrador solo para él.
  Cada uno con su propia contraseña, que el administrador le dicta (supuesto 2).

#### Supuesto 18. Un cobro rechazado después de liquidar no reabre la liquidación

- **Asumimos:** que al dueño le sirve saber qué se sabía al cerrar la ruta y
  qué se sabe hoy, y que un Yape que no llegó se persigue como deuda del
  cliente —que es donde queda: el cobro rechazado nunca bajó su deuda— y no
  reabriendo la ruta del chofer.
- **Construido encima:** `RouteSettlementService.getSettlementView` (el
  `expected` en vivo), `moneyDrifted` y el aviso de
  `apps/web-nuxt/app/pages/routes/[id]/settlement.vue`; el test «un cobro
  rechazado después de liquidar» de `route-settlement.int.test.ts`.
- **Preguntar:** si un cliente le pagó por Yape al chofer, usted ya cerró la
  ruta, y después ve que ese Yape nunca llegó, ¿quiere que la liquidación de
  ese día cambie, o le basta con verlo marcado y cobrárselo al cliente?
- **Si dice que no:** medio. Reabrir una liquidación pide una operación nueva
  (con quién, cuándo y por qué, como la corrección de una parada) y decidir
  qué pasa con lo que el chofer ya entregó en mano; no es un botón.
- **Si pregunta qué haríamos nosotros:** recomendamos que la liquidación de ese día quede como se cerró, con el aviso de que un cobro se cayó, y que ese monto se le cobre al cliente, que es donde queda como deuda.

## 5. Cuando algo se anotó mal

#### Supuesto 8. El administrador que corrige una parada queda como quien autorizó el precio

- **Asumimos** que, en una corrección, no hace falta preguntarle a nadie más:
  quien corrige es el administrador, la operación ya lleva su motivo escrito, y
  que él mismo figure como el que autorizó el precio de esa venta es fiel a lo
  que pasó. Asumimos también que al dueño no le molesta ver su propio nombre
  como autorizador en una corrección que no tocó ningún precio.
- **Construido encima:** `RoutesService.correctStop` manda
  `priceOverrideAuthorizedById: actor.id` SIEMPRE al volver a registrar la
  parada, no solo cuando el precio difiere, y el endpoint rechaza con 400 un
  `priceOverrideAuthorizedById` que venga en el cuerpo. Tiene un efecto de
  costado que conviene tener presente: `hasOverride` se calcula contra el
  precio VIGENTE HOY, así que una corrección que no toca el precio igual queda
  marcada como venta con precio autorizado si el `CustomerPrice` de ese cliente
  cambió desde la venta original.
- **Preguntar:** cuando usted corrige lo que se anotó de una visita, ¿alcanza
  con que quede su nombre y el motivo, o quiere que el sistema le pregunte
  aparte quién autorizó cobrar distinto de lo pactado?
- **Si dice que no:** barato. `correctionReason` ya viaja obligatorio; lo que
  cambia es dejar de forzar el autorizador y volver a exigirlo solo cuando el
  precio difiere de verdad, con un campo más en el formulario de corrección.
  Nada de esto toca la anulación ni el libro de movimientos.
- **Si pregunta qué haríamos nosotros:** recomendamos que alcance con su nombre y el motivo de la corrección, sin preguntarle aparte quién autorizó el precio.

#### Supuesto 9. La parada muestra solo la última corrección, no todas

- **Asumimos** que corregir una parada dos veces es raro, y que cuando pasa lo
  que la oficina necesita ver es cómo quedó y por qué se cambió la última vez.
  El historial completo de correcciones lo asumimos material de auditoría, no
  de la pantalla del día a día.
- **Construido encima:** las tres columnas `corrected_at` / `corrected_by` /
  `correction_reason` de `route_stops`, que una segunda corrección PISA. No se
  pierde nada: cada corrección deja su propia venta anulada —con su
  `voided_at`, `voided_by` y `void_reason`— y sus movimientos `*_VOID` en el
  libro, que es inmutable. La alternativa era una tabla
  `route_stop_corrections` con su modelo, su endpoint y su pantalla, para
  contar lo que esas dos fuentes ya cuentan.
- **Preguntar:** si una visita se corrige dos veces, ¿le sirve ver solo la
  última corrección con su motivo, o quiere la lista de todas las veces que se
  cambió, con quién y cuándo?
- **Si dice que no:** medio caro y toca esquema. Serían una tabla nueva de
  correcciones, una migración que además tendría que reconstruir el historial
  de lo ya corregido desde las ventas anuladas, y una pantalla que hoy no
  existe. No es una columna más: es un modelo.
- **Si pregunta qué haríamos nosotros:** recomendamos que la visita muestre solo la última corrección. Cuando la visita tenía una venta, la anterior queda anulada con su motivo y el libro de envases guarda todo; si la visita había quedado como no entregada, el motivo de la primera corrección se reemplaza con el de la segunda.

#### Supuesto 10. Corregir hacia arriba deja el camión en negativo en vez de frenar

- **Asumimos** que cuando el dueño corrige una visita y dice que se entregaron
  más bidones de los que el sistema creía que llevaba el camión, lo que hay que
  hacer es creerle y anotarlo: el camión ya volvió, el hecho físico está
  consumado, y frenarlo lo mandaría de vuelta al Excel, que es lo que esta
  operación existe para impedir. Asumimos también que el caso típico detrás de
  ese descuadre es una CARGA mal anotada, no una entrega inventada.
- **Construido encima:** `allowStockShortfall` en
  `SalesService.registerStopDeliveryWithinTransaction`, que solo prende
  `RoutesService.correctStop`. El chequeo de llenos en el camión deja de
  bloquear, el faltante viaja en `stockShortfall` y la pantalla lo avisa
  (`RouteMarkOutcome.vue`, desde el 2026-09-24) y la corrección se registra igual. Tiene dos
  consecuencias que conviene tener presentes: el saldo de ese camión queda
  **negativo** en `FULL_ON_ROUTE` —y por lo tanto también en el inventario
  general, igual que ya pasa con los saldos de envases de un cliente—, y si la
  ruta todavía está en curso, la siguiente entrega normal de esa ruta se
  rechaza con «hay -2». En una ruta ya terminada no molesta a nadie. Al
  registrar una entrega normal el chequeo **sigue bloqueando**: entregar lo que
  el camión no tiene no es un error de anotación, es imposible.
- **Preguntar:** si al corregir una visita resulta que se entregaron más
  bidones de los que figuraban cargados en el camión, ¿prefiere que el sistema
  lo anote igual y le avise, o que no lo deje y le pida primero arreglar la
  carga del camión?
- **Si dice que no:** barato del lado del código —es apagar el `true` en
  `correctStop`— pero caro de operación: la oficina tendría que corregir
  primero la carga de la ruta, y hoy `DELETE /routes/:id/loads/:loadId` solo
  funciona con la ruta PLANNED. Es decir, la alternativa no existe todavía:
  antes de apagarlo hay que darle a la oficina una forma de corregir la carga
  de una ruta que ya salió.
- **Si pregunta qué haríamos nosotros:** recomendamos que el sistema anote la corrección igual y le avise que el camión queda en negativo, porque el camión ya volvió y lo que se entregó ya se entregó.

## 6. Usuarios y contraseñas

#### Supuesto 2. Al cambiar una contraseña, el administrador la elige y la dicta

- **Asumimos:** que el administrador elige la contraseña nueva y se la dicta a
  la persona, en vez de que el sistema genere una temporal que la persona
  cambie al entrar.
- **Construido encima:** el bloque «Cambiar contraseña» de
  `apps/web-nuxt/app/pages/users.vue`. Hoy no existe pantalla de «cambiar mi
  contraseña» en `apps/web-nuxt/app/pages`, así que una temporal no tendría a
  dónde ir.
- **Preguntar:** cuando a alguien se le olvida su contraseña, ¿prefiere
  ponerle una usted y decírsela, o que el sistema le dé una provisional y que
  la persona se ponga la suya la primera vez que entre?
- **Si dice que no:** caro. Lo primero que falta es la pantalla de «cambiar mi
  contraseña» —que cualquier rol tiene que poder abrir—, y recién después el
  campo que marca la contraseña como provisional. No es un campo más en la
  pantalla de usuarios.
- **Si pregunta qué haríamos nosotros:** recomendamos que usted le ponga la contraseña y se la dicte. Es lo más simple mientras sean pocos usuarios; la contraseña provisional necesita una pantalla que hoy no existe.

#### Supuesto 3. El administrador puede cambiarse la contraseña a sí mismo

- **Asumimos:** que está bien que el administrador se cambie la suya desde la
  misma pantalla, y que esa es la forma prevista de rotar `admin123`.
- **Construido encima:** `users.vue` ofrece «Cambiar contraseña» también en
  la propia fila. La guarda de «es uno mismo» que sí tiene «Desactivar» —para
  no cerrarse la puerta desde adentro— deliberadamente no se aplica acá.
- **Preguntar:** ¿quiere poder cambiarse su propia contraseña desde esta
  pantalla, o prefiere que su contraseña se toque solo desde afuera del
  sistema?
- **Si dice que no:** barato en la pantalla, caro en la operación. Aplicar la
  misma guarda de `isSelf`, pero entonces rotar `admin123` vuelve a exigir un
  `UPDATE` a mano contra la base (ver «Password del admin de producción» en
  `backlog-tecnico.md`).
- **Si pregunta qué haríamos nosotros:** recomendamos que sí pueda cambiarse la suya desde la misma pantalla, y que lo haga hoy mismo con una contraseña que solo usted sepa.

#### Supuesto 4. Decirle que la sesión abierta no se cierra alcanza

- **Ahora sí se corta la sesión (2026-09-24, ítem 7b del plan, D-024):**
  cambiar la contraseña o desactivar a alguien deja viejo su refresh token, y
  el sistema le pide volver a ingresar en cuanto vence su acceso actual (a lo
  sumo 15 minutos). La pantalla dice eso ahora. El supuesto de abajo queda
  como registro de lo que se asumió mientras no era así; la pregunta sigue
  valiendo para saber si esos 15 minutos le alcanzan o necesita el corte en
  el acto. Vale también para el administrador que se cambia la suya
  (supuesto 3): su propia sesión se corta igual.
- **Asumimos:** que alcanza con **avisar** que cambiar la contraseña no cierra
  la sesión que esa persona tenga abierta, y que para cortarle el acceso hay
  que desactivarla.
- **Construido encima:** el aviso del bloque «Cambiar contraseña». Que la
  sesión no se cierre **no** es un supuesto: es un hecho del código, fijado por
  el test «resetting a user's password does NOT invalidate a refresh token
  already issued» en `apps/api/test/integration/auth.int.test.ts`. El supuesto
  es que decírselo sea suficiente.
- **Preguntar:** si le cambia la contraseña a alguien porque no quiere que siga
  entrando, ¿le sirve que esa persona siga adentro hasta que cierre sesión, o
  necesita que se caiga en ese momento?
- **Si dice que no:** caro, y no es un cambio de redacción. Hace falta
  invalidar tokens ya emitidos — ver «No hay forma de invalidar un token ya
  emitido» en `backlog-tecnico.md`, que además arrastra el caso de desactivar
  y reactivar.
- **Si pregunta qué haríamos nosotros:** recomendamos que alcance con que la persona quede afuera a lo sumo 15 minutos después de desactivarla (o de cambiarle la contraseña, que hace lo mismo). Hoy no hay forma de sacarla en el acto: si eso le hace falta, es trabajo nuevo.

#### Supuesto 15. Nadie de la planta tiene una cuenta para mirar sin tocar

- **Asumimos:** que en el piloto nadie necesita mirar sin tocar (un socio, un
  contador, alguien de la planta que controla).
- **Construido encima:** el enum `user_role` con `VIEWER`, los `@Roles` de
  los tres catálogos, `GET /auth/me`, `scripts/viewer-bootstrap.mjs` y el chequeo
  `checkViewerSession` de `scripts/smoke.mjs` (ítem 3 de
  `plan-endurecimiento.md`).
- **Preguntar (pregunta abierta):** ¿hay alguien que tenga que ver el sistema
  sin poder cambiar nada? ¿Qué tiene que ver: el padrón, las deudas, las
  rutas, los reportes? ¿Y qué NO?
- **Si dice que sí:** es **otro rol**, que se decide en el piloto con esas
  respuestas; no se reutiliza `VIEWER`, que es de CI y cuya credencial lee el
  deploy. Costo medio: valor nuevo del enum (migración expand), sus `@Roles`
  endpoint por endpoint y su menú en el web.
- **Si pregunta qué haríamos nosotros:** recomendamos que en el piloto nadie tenga una cuenta solo para mirar. Si hace falta, se crea un rol nuevo con lo que usted diga que esa persona puede ver.

## 7. El Panel

#### Supuesto 1. El buscador del Panel muestra clientes desactivados

- **Asumimos:** que un cliente desactivado que todavía debe plata es
  exactamente a quien viene a buscar en el Panel.
- **Construido encima:** `apps/web-nuxt/app/components/CustomerQuickSearch.vue`
  omite el filtro `active` que `CustomerPicker.vue` sí aplica. Buscar por
  nombre o teléfono devuelve clientes en uso y desactivados por igual.
- **Preguntar:** cuando busca a un cliente en la pantalla de inicio, ¿espera
  encontrar también a los que dio de baja, o esos deberían desaparecer de la
  búsqueda?
- **Si dice que no:** barato. Agregarle `active: true` a la consulta de
  `/customers` en ese componente, igual que hace `CustomerPicker.vue`. No
  cambia el diseño de la búsqueda.
- **Si pregunta qué haríamos nosotros:** recomendamos que el buscador del Panel siga trayendo también a los clientes dados de baja, porque el que se dio de baja y todavía debe es justo al que uno busca para cobrarle.

## Hoja de cierre

Una fila por pregunta. En «Qué pasó» se marca una sola de las tres: **Respondió
la pregunta** (eligió sin que le propusiéramos nada), **Aprobó la
recomendación** (le dijimos qué haríamos y dijo que sí) o **Dijo otra cosa**.
El destino es lo que hay que hacer después en
[`supuestos-por-validar.md`](./supuestos-por-validar.md): si respondió o aprobó,
el supuesto baja a **Validados** con la fecha, lo que se decidió y esa línea
de «Cómo se resolvió»; si dijo otra cosa, se borra de Pendientes y se abre lo
que corresponda en `backlog-tecnico.md` (su línea «Si dice que no» dice
cuánto cuesta).

| Pregunta                                                                         | Qué pasó                             | Qué dijo, en una línea | Destino             |
| -------------------------------------------------------------------------------- | ------------------------------------ | ---------------------- | ------------------- |
| 14. El padrón del sistema viejo entra entero, sin zona y sin envases             | ☐ Respondió · ☐ Aprobó · ☐ Otra cosa |                        | Validados / backlog |
| 13. «Debe desde» es el cargo que abrió la deuda actual                           | ☐ Respondió · ☐ Aprobó · ☐ Otra cosa |                        | Validados / backlog |
| Precios de lista (operativa)                                                     | ☐ Respondió · ☐ Otra cosa            |                        | Se carga en la app  |
| 17. Un pedido se cobra al precio del día en que se entrega                       | ☐ Respondió · ☐ Aprobó · ☐ Otra cosa |                        | Validados / backlog |
| 7. El cliente devuelve los vacíos en la visita siguiente, no en el momento       | ☐ Respondió · ☐ Aprobó · ☐ Otra cosa |                        | Validados / backlog |
| 11. Los llenos que vuelven reponen el lote más antiguo del que salieron          | ☐ Respondió · ☐ Aprobó · ☐ Otra cosa |                        | Validados / backlog |
| ¿Sabe cuántos bidones tiene cada cliente? (operativa)                            | ☐ Respondió · ☐ Otra cosa            |                        | Se carga en la app  |
| 16. Las etiquetas de lugar del sistema viejo son las zonas de reparto            | ☐ Respondió · ☐ Aprobó · ☐ Otra cosa |                        | Validados / backlog |
| Días de reparto (operativa)                                                      | ☐ Respondió · ☐ Otra cosa            |                        | Se carga en la app  |
| 12. El chofer registra sus paradas en el celular, en línea y sin cambiar precios | ☐ Respondió · ☐ Aprobó · ☐ Otra cosa |                        | Validados / backlog |
| 5. Quitarle el rol de chofer a alguien avisa, pero no bloquea                    | ☐ Respondió · ☐ Aprobó · ☐ Otra cosa |                        | Validados / backlog |
| 6. Las rutas conservan al chofer que las hizo                                    | ☐ Respondió · ☐ Aprobó · ☐ Otra cosa |                        | Validados / backlog |
| Choferes y oficina (operativa)                                                   | ☐ Respondió · ☐ Otra cosa            |                        | Se carga en la app  |
| 18. Un cobro rechazado después de liquidar no reabre la liquidación              | ☐ Respondió · ☐ Aprobó · ☐ Otra cosa |                        | Validados / backlog |
| 8. El administrador que corrige una parada queda como quien autorizó el precio   | ☐ Respondió · ☐ Aprobó · ☐ Otra cosa |                        | Validados / backlog |
| 9. La parada muestra solo la última corrección, no todas                         | ☐ Respondió · ☐ Aprobó · ☐ Otra cosa |                        | Validados / backlog |
| 10. Corregir hacia arriba deja el camión en negativo en vez de frenar            | ☐ Respondió · ☐ Aprobó · ☐ Otra cosa |                        | Validados / backlog |
| 2. Al cambiar una contraseña, el administrador la elige y la dicta               | ☐ Respondió · ☐ Aprobó · ☐ Otra cosa |                        | Validados / backlog |
| 3. El administrador puede cambiarse la contraseña a sí mismo                     | ☐ Respondió · ☐ Aprobó · ☐ Otra cosa |                        | Validados / backlog |
| 4. Decirle que la sesión abierta no se cierra alcanza                            | ☐ Respondió · ☐ Aprobó · ☐ Otra cosa |                        | Validados / backlog |
| 15. Nadie de la planta tiene una cuenta para mirar sin tocar                     | ☐ Respondió · ☐ Aprobó · ☐ Otra cosa |                        | Validados / backlog |
| 1. El buscador del Panel muestra clientes desactivados                           | ☐ Respondió · ☐ Aprobó · ☐ Otra cosa |                        | Validados / backlog |
