# Backlog técnico

Deuda aceptada a conciencia. Cada entrada dice qué se hizo, por qué se aceptó
y cuál es el disparador que obliga a resolverla.

## Refresh token en localStorage

**Estado:** abierto. **Disparador:** antes del piloto de campo.

El refresh token se guarda en `localStorage` (`apps/web/src/auth/token-storage.ts`)
y el access token vive solo en memoria, en el estado de React.

Cualquier XSS que consiga ejecutar script en el origen puede leer el refresh
token y quedarse con una sesión renovable. El access token en memoria no se
persiste, así que sobrevive menos, pero el refresh es el que importa.

Se aceptó para el esqueleto porque la alternativa correcta —cookie `httpOnly`

- `SameSite` emitida por la API— exige cambiar el contrato de
  `POST /api/v1/auth/refresh`: hoy el refresh token viaja en el header
  `Authorization` (`JwtRefreshStrategy` lo extrae con
  `ExtractJwt.fromAuthHeaderAsBearerToken()`), y pasarlo a cookie implica tocar
  la estrategia, el guard, CORS con credenciales y el flujo de logout.

**Para cerrarla:** emitir el refresh token como cookie `httpOnly`, `Secure`,
`SameSite=Lax` desde la API; que `/auth/refresh` la lea de la cookie en vez del
header; agregar un `POST /auth/logout` que la invalide; y borrar
`token-storage.ts` del cliente.

## No hay endpoint de usuario actual

**Estado:** abierto. **Disparador:** cuando la UI necesite datos del usuario
que no estén en el token (nombre completo, estado `active`, permisos finos).

La API no expone `/auth/me`, y `GET /api/v1/users` es solo `ADMIN`, así que un
`SELLER` o un `DRIVER` no puede consultarse a sí mismo. El cliente resuelve la
identidad decodificando el payload del access token
(`apps/web/src/api/decode-token.ts`): trae `sub`, `username` y `roles`, que es
todo lo que la UI necesita hoy.

Esto es seguro —la firma la verifica el servidor en cada petición, y un token
manipulado en el navegador solo consigue un 401— pero el payload es una foto
del momento del login: si a un usuario le cambian los roles o lo desactivan, la
UI sigue mostrando lo viejo hasta el próximo refresh.

**Para cerrarla:** agregar `GET /api/v1/auth/me` protegido con `JwtAccessGuard`
que devuelva el usuario desde la base, y usarlo como fuente de verdad en la UI.

## Password del admin de producción

**Estado:** abierto. **Disparador:** antes del piloto de campo con datos reales.

El usuario `admin` de la base de producción (Neon, proyecto `yacco-production`)
quedó con la contraseña `admin123` **solo para la Demo 1**. Es la contraseña por
defecto del seed (`apps/api/prisma/seed.ts`, `SEED_ADMIN_PASSWORD ?? "admin123"`)
y es pública: está en el repositorio, en `LoginDto` como ejemplo de Swagger y en
esta misma línea.

Mientras la base solo tenga datos de demostración el riesgo es aceptable. En el
momento en que entren clientes, ventas o deudas reales, deja de serlo: cualquiera
que encuentre la URL de la API entra como ADMIN.

**Para cerrarla:** rotar a una contraseña fuerte, ya sea corriendo el seed contra
producción con `SEED_ADMIN_PASSWORD` apuntando al valor nuevo, o con un `UPDATE`
manual del `password_hash` (bcrypt, 10 rondas). Guardar el valor en el gestor de
credenciales, nunca en el repositorio ni en un `.env` versionado.

## Precios de lista del catálogo de productos

**Estado:** abierto. **Disparador:** antes del piloto de campo.

Precios de lista del catálogo son placeholder; confirmar con el cliente antes
del piloto de campo. Los cuatro productos sembrados en
`apps/api/prisma/seed.ts` (recargas y bidones de 20L, con y sin caño) llevan
`listPrice` provisional (S/ 8.00 la recarga, S/ 30.00 / S/ 28.00 el bidón) para
que el módulo de Orders tenga algo con qué capturar un pedido en la demo.

**Para cerrarla:** confirmar los precios reales con el dueño de la planta y
actualizar el seed (o los `Product.listPrice` en la base ya sembrada) antes de
que un pedido real se capture contra ellos.

## El detalle de pedido no puede mostrar quién lo registró

**Estado:** abierto. **Disparador:** cuando el dueño de la planta pida ver
quién tomó un pedido.

`OrderResponseDto` expone `createdById` pero no el nombre del creador; el
detalle no puede mostrar quién registró el pedido. `apps/web/src/pages/order-detail-page.tsx`
omite el campo en vez de mostrar el UUID crudo, que no le sirve a quien mira
la pantalla.

**Para cerrarla:** que `OrdersService.toOrderResponse` incluya el usuario
(al menos `username`) en el `include` de Prisma, igual que ya hace con
`customer` e `items.product`.

## No se puede asignar zona a un cliente desde la UI

**Estado:** abierto. **Disparador:** cuando exista un módulo Zones (listado y
seed) para elegir de ahí.

El formulario de crear/editar cliente pedía `zoneId` como texto libre con
formato UUID v4, pero no existe módulo de Zones: no hay endpoint para
listarlas y el seed no siembra ninguna, así que no había forma de que un
usuario supiera o escribiera un valor válido. Se probó contra producción y
resultó en un campo imposible de llenar correctamente, así que se quitó del
formulario (`apps/web/src/components/customer-form.tsx`). `zoneId` sigue
siendo opcional en `CreateCustomerDto`/`UpdateCustomerDto` — sin cambios en
el backend — y la lista de clientes sigue mostrando la zona de quien ya la
tenga (`customers-page.tsx`); solo se omitió el campo de entrada.

**Para cerrarla:** agregar un módulo Zones de solo lectura (mínimo
`GET /api/v1/zones`, con datos sembrados) y, en el formulario, un `<select>`
cargado de ahí en vez del texto libre — el mismo patrón que `api/products.ts`
y el `<select>` de producto en `order-items-form.tsx`. Hasta entonces,
`zoneId` solo se puede poblar por API.

## No hay gestión del catálogo payment-methods

**Estado:** abierto. **Disparador:** cuando aparezca un medio de cobro fuera
de los cuatro sembrados (Efectivo, Transferencia, Yape, Plin), o cuando el
dueño quiera cambiar el `requiresConfirmation` de alguno.

`GET /api/v1/payment-methods` (solo lectura) existe, pero no hay
`POST`/`PATCH`: los métodos solo se crean por el seed o por el upsert
sintético de `roster-loader.service.ts` ("Apertura", nacido inactivo a
propósito — nunca una forma de cobro real). Si la planta empieza a aceptar
una billetera nueva, o si `requiresConfirmation` de un método existente
estuvo mal decidido, hoy la única forma de corregirlo es una migración de
datos a mano, el mismo patrón que
`20260827170000_deactivate_opening_payment_method` — no un flujo pensado
para repetirse.

**Para cerrarla:** agregar `POST`/`PATCH /api/v1/payment-methods` (ADMIN),
mismo patrón que `ZonesController`/`ContainerTypesController`: crear con
nombre único, y editar solo `active`/`requiresConfirmation` (el nombre, una
vez que un pago ya lo referencia, no debería poder cambiar en caliente sin
pensar el impacto en reportes de cobranza por medio de pago).

## La matriz de transiciones de envases está duplicada

**Estado:** abierto. **Disparador:** antes de tocar las transiciones de ruta
en S5 (`ROUTE_LOAD`, `LOAN_DELIVERY`, `EMPTY_PICKUP`, `FULL_RETURN`,
`EMPTY_UNLOAD`) — `packages/shared` debe existir con contenido real ANTES de
ese sprint, no durante ni después.

`CONTAINER_MOVEMENT_TRANSITIONS` (`apps/api/src/modules/container-movements/container-movement-transitions.ts`)
define qué pares (`fromState`, `toState`) admite cada `ContainerMovementType`,
y no hay ningún endpoint que la exponga: el DTO valida el par en el servicio,
no con decoradores, así que ni siquiera el schema de Swagger la refleja.

La pantalla de movimientos de envases (`apps/web/src/lib/container-movement-transitions.ts`)
necesita esa regla para ofrecer solo los orígenes válidos de las tres
operaciones que registra a mano (`FLEET_ENTRY`, `DAMAGE_WRITE_OFF`,
`LOSS_WRITE_OFF`), así que la copia a mano, acotada a esas tres — nunca a la
matriz completa. Un desfase entre las dos copias no corrompe datos: el
backend sigue validando en `POST /container-movements`, así que en el peor
caso el usuario ve un 400 con el mensaje real del servidor, nunca un envío
aceptado en silencio.

El test de este espejo (`apps/web/src/lib/container-movement-transitions.test.ts`)
no importa `container-movement-transitions.ts` de `apps/api` para comparar
contra la fuente real: ese archivo importa `ContainerMovementType` y
`ContainerState` desde `@prisma/client`, que no es dependencia de `apps/web`,
y agregarlo solo para un test metería el cliente de base de datos —Prisma,
sus tipos generados, potencialmente su motor— en el bundle que llega al
navegador. El test se limita entonces a afirmar la auto-consistencia del
espejo (qué operaciones y pares ofrece), no que coincida con el backend.

Hoy el riesgo es bajo: tres tipos, dos con un único par. Deja de serlo en S5,
cuando la app de reparto empiece a emitir `ROUTE_LOAD`/`LOAN_DELIVERY`/etc. y
alguna pantalla de oficina necesite mostrar o validar esos mismos pares —dos
copias de una matriz de 9 tipos, mantenidas a mano en repos separados, es
donde un desfase real se vuelve probable, no solo teórico.

**Para cerrarla:** mover `container-movement-transitions.ts` a
`packages/shared` y que `apps/api` importe de ahí en vez de tener su propia
copia local; `apps/web` deja de necesitar el espejo manual y su test puede
importar la matriz real en vez de solo auto-verificarse.

## Reparto de un pago global entre deudas del cliente

**Estado:** abierto. **Disparador:** cuando exista el módulo de Payments.

Un pago sin `locationId` (Payment.locationId es opcional, spec: sin locación
el principal paga a nivel del cliente consolidado) puede tener que saldar
deuda acumulada en varias ventas/locaciones a la vez. La regla de negocio
decidida con el cliente: el reparto se hace saldando primero la deuda más
antigua (FIFO por fecha de venta/deuda), con posibilidad de asignación manual
por el usuario cuando el reparto automático no sea el que corresponde (p.ej.
el cliente indica que ese pago es específicamente para una venta puntual).

**Para cerrarla:** implementar esta regla en el servicio de Payments cuando
se construya (aún no existe ningún módulo de Sales/Payments en `apps/api/src`),
como parte de la lógica de creación de un pago sin `locationId`.

## Certeza del saldo de apertura de envases en poder del cliente

**Estado:** resuelta.

Decisión de dominio tomada con el dueño de la planta: los saldos de envases
prestados que se carguen en la apertura no tienen todos el mismo grado de
confianza. De algunos clientes el dueño sabe con certeza cuántos envases
tienen; de otros es una estimación, porque el repartidor a veces no anotaba
la entrega.

Esa diferencia debe sobrevivir a la carga inicial: el saldo de apertura lleva
su propio grado de certeza (al menos "confirmado" vs. "estimado"), y tiene
que existir una forma de que un saldo estimado pase a confirmado cuando
alguien lo verifique físicamente — algo que va a ocurrir durante el piloto,
cuando el conductor llegue a un cliente y cuente lo que tiene.

**Razón:** sin el origen del número, un saldo de "5 envases" es indistinguible
entre dato duro y aproximación, y esa distinción es justo la que decide si un
reclamo al cliente se sostiene con evidencia o con insistencia. Es coherente
con la filosofía ya aceptada en el resto del sistema: las discrepancias se
registran, nunca se suprimen (mismo espíritu que el ajuste de una liquidación
con descuadre, o la advertencia de sobreproducción de un lote).

**Cómo quedó resuelta:** no como una columna de "confirmado"/"estimado" en el
saldo de apertura, sino como algo derivado. `OPENING_BALANCE` registra lo que
el cargador del padrón creyó al arrancar, sin distinguir origen — esa carga
es siempre la estimación de partida. `ContainerCount`, el libro de conteos
físicos, es la fuente de la certeza real: su sola existencia para una
locación y tipo de envase, con la fecha `countedAt` del conteo más reciente,
dice si ese saldo está confirmado y desde cuándo. Un saldo sin ningún conteo
posterior a su `OPENING_BALANCE` sigue siendo la estimación original; uno con
un conteo posterior queda confirmado a esa fecha — sin guardar la etiqueta en
ningún lado, se consulta.

## Lista fija de migraciones en customer-locations-migration.int.test.ts

**Estado:** RESUELTA en PR #49 (`fix/migration-test-no-parking`). Se
conserva la entrada como registro: la lista tuvo que ampliarse tres veces en
un solo sprint (`container_count`, `container_count_check`,
`opening_balance_indexes`) antes de cerrarse de raíz.

**Cómo se cerró:** el test ya no mueve carpetas del repo ni conoce nombres de
migraciones. Copia `schema.prisma` y las migraciones a un directorio temporal
y corre `migrate deploy --schema <tmp>/schema.prisma`: en la primera pasada
copia solo las carpetas cuyo nombre es menor que
`20260822090000_customer_locations` (el prefijo de timestamp ordena igual que
la cronología), y en la segunda copia todas. `prisma/migrations` no se toca
en ningún momento, así que tampoco hace falta el `finally`/`afterAll` que
restauraba las carpetas si el proceso moría a medias.

_Texto original de la entrada, tal como se escribió cuando estaba abierta:_

**Estado (original):** abierto. **Disparador:** antes del siguiente PR que
agregue una migración con FK a `customer_locations`.

Este test prueba el backfill de la migración `customer_locations` aparcando
temporalmente su carpeta (y las de cualquier otra migración que dependa de
ella) para simular el esquema previo, insertando filas con ese esquema viejo,
y restaurando todo para comprobar que el backfill las reconecta sin pérdida.
Qué carpetas aparcar vive en una constante fija, `NEW_MIGRATION_NAMES`, que
hoy lista `customer_locations` más las dos de `container_counts` (ambas con
FK a `customer_locations`).

Esa lista es manual: cada migración futura que agregue una FK a
`customer_locations` tiene que añadirse a mano ahí también, o el `migrate
deploy` del primer paso del test intenta crear esa FK contra una base que
todavía no tiene la tabla y falla. Ya pasó una vez en este mismo sprint —
las migraciones de `container_counts` rompieron este test hasta que se las
agregó a la lista— y el síntoma es confuso a propósito: un `Command failed:
pnpm exec prisma migrate deploy` en un archivo de test que el PR de turno no
tocó, sin ninguna pista de que la causa es una FK nueva en un módulo no
relacionado.

**Razón:** una lista mantenida a mano que un PR ajeno tiene que recordar
actualizar es del mismo tipo de fragilidad que el resto del sistema evita en
el código de producción (el catálogo que se deriva de otro recurso, el
vocabulario hardcodeado) — aquí sobrevive porque es un test, pero el costo es
el mismo: alguien pierde tiempo diagnosticando un fallo que no tiene relación
aparente con su cambio.

**Para cerrarla:** rediseñar el parking para que no dependa de nombrar
migraciones. En vez de mover las carpetas reales fuera de
`prisma/migrations` (lo que las hace "no existir" para cualquier otra
migración que las necesite), copiar a un directorio temporal solo las
migraciones _anteriores_ a `customer_locations` por criterio cronológico
(comparando el prefijo de fecha del nombre de carpeta) y correr
`migrate deploy` apuntando ese directorio temporal como `prisma/migrations`
para el primer paso. Así el primer deploy nunca ve ninguna migración
posterior a `customer_locations` — ni las que existen hoy ni las que se
agreguen mañana — sin que el test tenga que conocer sus nombres.

## Sin lock sobre customer_container_balances al leer-y-reescribir

**Estado:** aceptado. **Disparador:** más de dos rutas cargando/entregando al
mismo tiempo, o un descuadre real que `GET /container-reconciliation` reporte
sin que se le encuentre una causa identificable en el código.

Tanto `ContainerMovementsService.createWithinTransaction` como
`ContainerCountsService.create` leen la fila de `customer_container_balances`
(`findUnique`) y escriben la cantidad absoluta resultante dentro de la misma
transacción, pero sin tomar `SELECT ... FOR UPDATE` sobre esa fila antes de
leerla. Dos transacciones concurrentes sobre el mismo par
(locación, tipo de envase) pueden intercalarse: ambas leen el mismo valor
base, cada una calcula su propio delta sobre él, y la segunda en escribir
pisa el resultado de la primera en vez de sumarse a él — una pérdida de
actualización clásica.

**Razón:** con solo dos rutas operando hoy, dos transacciones chocando sobre
el mismo par exacto en la misma ventana de milisegundos es improbable. Tomar
el lock evitaría esa colisión, pero a cambio metería contención justo en el
camino de carga de ruta (`ROUTE_LOAD`) — donde ya importa que el reparto
salga rápido — para cubrir un caso más angosto que el que ya cubre
`GET /container-reconciliation`: la rutina de cuadre detecta el descuadre
sin importar si la causa fue una pérdida de actualización concurrente o un
bug de lógica, así que ya es la red de seguridad que un lock solo duplicaría
parcialmente.

**Para cerrarla:** si el piloto agrega una tercera ruta operando en
simultáneo, o si el cuadre reporta un descuadre real que no se explica por
ningún bug de código, agregar `SELECT ... FOR UPDATE` sobre la fila de
`customer_container_balances` (o de `CustomerContainerBalance` vía
`queryRaw`, ya que Prisma no expone `FOR UPDATE` en su API tipada) antes de
leerla, en ambos servicios.

## Falta la rutina de cuadre del dinero

**Estado:** abierto. **Disparador:** cuando exista el camino de escritura de
ventas y pagos en S4.

`GET /container-reconciliation` (`ContainerReconciliationService`) tiene un
equivalente pendiente para el dinero: comparar `debtBalance` de cada cliente
contra la suma de `sales.total` menos la suma de `payments.amount` de todas
sus locaciones — incluyendo los registros de apertura de ambos tipos
(`isOpeningBalance`), porque son cargos y abonos legítimos, no ruido a
filtrar.

Mismo diseño y misma razón que la rutina de envases: reconstrucción en SQL
escrita independiente del código que materializa (`SalesService`, y el
futuro camino de ventas/pagos de S4), para que sea una segunda opinión sobre
el libro y no una función comprobándose a sí misma; reporta y no repara;
`LEFT JOIN` en las resoluciones de nombre para no descartar en silencio una
fila huérfana.

Asimetría a tener en cuenta al escribir la consulta: `sales` cuelga de
`location_id` (sin `customer_id` propio, igual que la limitación que
`SalesService.assertNoOpeningBalanceExists` ya resuelve con un join a
`customer_locations`), mientras que `payments` sí carga `customer_id`
directamente. La reconstrucción tiene que agrupar `sales` por cliente a
través de la locación antes de poder restarle `payments`, que ya viene
agrupable por cliente sin join.

**Para cerrarla:** diseñar junto con el camino de escritura de ventas y pagos
de S4 — no antes: hasta entonces `sales`/`payments` solo tienen los dos
registros de apertura por cliente que `SalesService` puede crear, sin
suficiente superficie para que la rutina demuestre nada.

## Clientes con saldo a favor al cierre del cuaderno

**Estado:** resuelto (diseño); pendiente de código en S4.

Consultado con el dueño: existen clientes con saldo a favor al cierre del
cuaderno, y son adelantos puntuales o vueltos no devueltos, NO un modelo de
cobro por adelantado. Se resuelven con un abono de apertura simétrico al
cargo (`SalesService.createOpeningCredit`), y por eso `debtBalance` puede
quedar negativo — pero solo por la apertura, no por operación normal:
`debt_balance` no tiene CHECK de no negatividad (verificado), así que no hizo
falta ninguna migración para permitirlo.

**Consecuencia para S4:** la regla de distribución "deuda más antigua
primero" no necesita una rama especial para un pago sin cargos que cubrir —
un saldo de partida negativo ya es, aritméticamente, "esta deuda no existe
todavía". Pero el control de límite de crédito sí necesita cuidado: debe
leer un `debtBalance` negativo como lo que es (crédito a favor del cliente),
nunca como deuda, o un cliente con saldo a favor podría aparecer excediendo
su límite por un cálculo que interpreta mal el signo.

**Para cerrarla:** cuando se construya el control de límite de crédito de
S4, agregar un test que cubra explícitamente un cliente con `debtBalance`
negativo comprando contra su límite, para que esa lectura de signo quede
verificada y no solo documentada acá.

## CHECK de no negatividad en customer_container_balances

**Estado:** RESUELTA en PR #51 (`fix/allow-negative-container-balance`).
No existía entrada previa: se registra aquí junto con su cierre, para que
quede el escenario que lo motivó.

`customer_container_balances` tenía `CHECK (quantity >= 0)`
(`customer_container_balances_quantity_check`) desde la migración inicial.
Escenario real, confirmado con el dueño: el conductor anterior se olvidó de
anotar una entrega, el sistema cree que el cliente tiene 2 envases y el
cliente devuelve 3. El saldo intentaba bajar a -1 y la transacción moría con
un error crudo de Postgres, en el celular del conductor, a media ruta.

**Razón:** eso es lo contrario de "alerta sin bloquear", la filosofía del
cliente para operaciones de campo. Un saldo en -1 ES información: dice que
hay una entrega sin registrar. Bloquearlo solo consigue que el conductor no
registre la devolución, y entonces se pierden las dos cosas.

**Cómo se cerró:** migración `20260824164243_allow_negative_container_balance`
elimina el CHECK del saldo. El CHECK de `container_counts.counted_quantity

> = 0` se queda: lo que se cuenta no puede ser negativo; lo que el sistema
> CREE que hay sí, porque la creencia puede estar equivocada y el signo es
> justamente la señal. Fuera del CHECK no había ninguna validación en
> servicios, DTOs, tipos ni web que asumiera saldo no negativo (la web ya
> trataba el negativo del inventario como señal). La rutina de cuadre no
> reporta un negativo consistente entre libro y materializado — no es un
> descuadre suyo, es un hallazgo operativo que le corresponde al reporte de
> envases prestados, que aún no existe (ver pendiente abajo).

**Pendiente derivado:** reporte de envases prestados que muestre los saldos
negativos como "entrega sin registrar". No es parte de este cierre.

## El auto-deploy de yacco-api puede no dispararse sin error visible

**Estado:** abierto. **Disparador:** antes del piloto de campo (a partir de
ahí, `main` y producción desincronizados afectan a usuarios reales).

El webhook de auto-deploy de `yacco-api` en Render puede no dispararse para
un commit de `main` sin dejar error en ninguna parte: ni en GitHub, ni en la
pantalla de Events de Render, ni en la API que sigue sirviendo la versión
anterior con `/health` en 200. `main` y producción quedan desincronizados en
silencio.

Ocurrió con `89deab1` (PR #50) el 24/08/2026: media hora después del merge,
Events de Render no tenía ningún deploy para ese commit — el último era
`88370a6` (PR #49). La migración de #50 llegó a Neon solo porque Giancarlo
lanzó un Manual Deploy a mano.

**Razón:** se detectó únicamente porque el commit llevaba migración y se
estaba vigilando `_prisma_migrations` en Neon. Un commit sin migración no
habría dado ninguna señal: producción habría seguido corriendo código viejo
indefinidamente, con todos los checks en verde.

**Mitigación pendiente:** exponer `RENDER_GIT_COMMIT` en `/health`, para
poder comparar lo desplegado contra el tip de `main` en segundos, sin
depender de que el commit traiga migración. Es su propio PR.

## Producción puede tener catálogos desincronizados del seed y nada lo detecta

**Estado:** abierto. **Disparador:** antes del piloto de campo.

`payment_methods` en Neon quedó con `requires_confirmation = false` en
Transferencia, Yape y Plin — el seed (`apps/api/prisma/seed.ts`, líneas
86-91) ya los define en `true`, pero la base se sembró una vez, antes de que
eso fuera así, y el `buildCommand` de Render corre `db:deploy` pero nunca
`db:seed`, así que la desincronización no se corrige sola. Se encontró por
casualidad mirando el catálogo por otro motivo y se corrigió con la
migración de datos `20260827180000_require_confirmation_wallet_payment_methods`.

`container_types`, `products` y `roles` podrían tener el mismo problema —sus
filas también solo se escriben por el seed— y no hay forma de saberlo sin
consultarlos uno por uno contra producción.

El seed es idempotente (todo `upsert`, salvo `Product.create` en la línea 74,
que es un `create` y fallaría en la segunda corrida) y no crea datos de
demo, así que agregar `pnpm db:seed` al `buildCommand` de Render es una
opción viable a evaluar para que esto deje de poder repetirse — con esa
salvedad. El upsert del usuario admin tampoco pisa la contraseña ya
rotada en producción (`update: {}`, ver "Password del admin de producción"
arriba), así que un re-seed no revierte eso.

**Para cerrarla:** decisión de infraestructura de Giancarlo: agregar
`pnpm db:seed` al `buildCommand` de Render (arreglando antes el `create` de
la línea 74 para que sea idempotente), o algún otro mecanismo que detecte
un catálogo desincronizado sin depender de que alguien lo note a ojo.

## Test flaky en apps/web: customers-page falla bajo carga

**Estado:** abierto. **Disparador:** antes del piloto de campo.

`src/pages/customers-page.test.tsx` (caso «Siguiente» pide la página 2 y
muestra sus filas) falló el 24/08/2026 corriendo `pnpm test` completo (toda
la suite de web en paralelo con la de api) y pasó aislado 12/12 en el mismo
árbol, sin cambiar nada. No se persiguió en ese momento porque el PR de
turno (#51) no tocaba la web.

**Razón:** un test que enseña a ignorar el rojo es un pasivo. Con el piloto
encima hay que poder confiar en el CI sin pensarlo: si un fallo en
`customers-page` puede ser "el flaky de siempre", el día que sea real se va
a descartar igual; y si empieza a fallar en CI, o se reintenta a ciegas o se
bloquea `main` por nada.

**Para cerrarla:** reproducirlo bajo carga (la suite completa de web, o el
archivo en bucle con `--reporter=verbose`) y encontrar la carrera: lo más
probable es una espera sobre la segunda página que se resuelve antes de que
el mock de la API cambie de respuesta, o un `findBy` con timeout justo. La
salida es una espera explícita sobre el estado que el test necesita, no un
`retry` ni un timeout más largo.
