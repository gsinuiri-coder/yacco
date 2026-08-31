# Backlog técnico

Deuda aceptada a conciencia. Cada entrada dice qué se hizo, por qué se aceptó
y cuál es el disparador que obliga a resolverla.

> **Documento hermano:** [`supuestos-por-validar.md`](./supuestos-por-validar.md)
> — decisiones de producto tomadas sin preguntarle al dueño de la planta, con
> código encima. No son deuda técnica: son las preguntas que hay que hacerle en
> la próxima demo. Si una entrada de acá depende de que un supuesto sea cierto,
> lo dice y apunta ahí.

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

## La gestión de usuarios no cambia contraseñas ni roles

**Estado:** resuelta a medias, y por eso se parte en dos. La mitad de la
contraseña se cerró **en código**, con sus decisiones de forma todavía sin
validar con el dueño de la planta (ver abajo); la de los roles sigue abierta
en «La gestión de usuarios no cambia roles», acá abajo.

**Cómo se cerró la mitad de la contraseña:** `users-page.tsx` cambia la
contraseña desde un bloque aparte, abierto con «Cambiar contraseña» en la
fila.

Las tres preguntas que la entrada dejaba sin decidir se resolvieron **entre
Giancarlo y la capa arquitectónica, como supuestos de trabajo. El dueño de la
planta todavía no vio esta pantalla y no validó ninguna de las tres.** Se
anotan como supuestos y no como decisiones suyas a propósito: el día que diga
que prefiere otra cosa, este documento tiene que mostrar que nunca se lo
preguntamos, no que dijo que sí.

Las tres viven en
[`supuestos-por-validar.md`](./supuestos-por-validar.md) —#2, #3 y #4—, con la
pregunta redactada y qué cambia según lo que conteste. Acá van en una línea:

- **Quién y cómo:** el administrador la elige y se la dicta; no hay contraseña
  temporal, porque no existe pantalla de «cambiar mi contraseña» a la que esa
  temporal pudiera llevar.
- **El administrador puede cambiarse la suya:** es la forma prevista de rotar
  `admin123` (ver «Password del admin de producción»). La guarda de `isSelf`
  que sí tiene «Desactivar» no aplica acá.
- **Qué pasa con la sesión abierta:** no se cierra. Eso **no** es supuesto —es
  un hecho del código, fijado por un test en `auth.int.test.ts` y explicado en
  «No hay forma de invalidar un token ya emitido». El supuesto es que
  decírselo en pantalla alcance.

## La gestión de usuarios no cambia roles

**Estado:** resuelta.

`users-page.tsx` corrige los roles desde un bloque propio, abierto con «Roles»
en la fila. Con eso `users` pasó a `Completo` en `docs/estado-por-modulo.md`.

**Qué se decidió sobre las rutas ya planificadas**, que era lo que faltaba: no
se tocan. Nunca se reasignan, ni se cancelan, ni se marcan. `route.driverId` es
un hecho histórico —quién hizo ese reparto— y reescribirlo para acomodar un
cambio de rol de hoy sería falsear el libro.

Ninguna ruta queda sin quien la opere, y por eso alcanza con avisar: ADMIN y
SELLER pasan `assertCanAccessRoute` siempre, así que una ruta de alguien que
dejó de ser chofer se sigue pudiendo terminar desde la oficina. Lo único que
pierde esa persona es abrirla desde su teléfono. `RoutesService.create` valida
el rol solo al crear la ruta, y eso está bien: valida el momento en que se
decide a quién se le asigna.

La pantalla, antes de mandar el PATCH que quita `DRIVER`, cuenta las rutas
`PLANNED` e `IN_PROGRESS` de esa persona y pide confirmación **diciendo el
número**. Avisa, no bloquea. Si la consulta falla, se confirma igual diciendo
que no se pudo verificar — nunca inventando un cero. Acopla la pantalla de
usuarios al cliente de rutas a propósito: un aviso genérico no responde la
pregunta que el dueño se va a hacer, que es si le puede quitar el rol ahora o
conviene esperar a que cierre la ruta de hoy.

**La guarda de auto-degradación bajó a la API.** `UsersService.update` recibe
el actor del token y rechaza con 400 que se quite a sí mismo el rol ADMIN o se
ponga `active: false`. La mitad de desactivar vivía solo en la web, y Swagger o
un `curl` la salteaban. Una sola guarda, y deliberadamente **sin contar
administradores**: si nadie puede quitarse a sí mismo, siempre queda al menos
quien está haciendo el cambio. La razón está escrita en el código, porque es el
primer refactor que alguien va a querer hacerle.

**Lo que quedó anotado como supuesto:** avisar sin bloquear al quitar DRIVER, y
que las rutas conserven al chofer que las hizo, son decisiones de producto que
el dueño de la planta no vio. Están en
[`supuestos-por-validar.md`](./supuestos-por-validar.md), #5 y #6.

## No hay forma de invalidar un token ya emitido

**Estado:** abierto. **Disparador:** antes del piloto de campo, o el día que
haya que sacar a alguien del sistema en el acto.

El esquema no guarda nada por sesión: ni `tokenVersion` en `users`, ni `jti`,
ni una tabla de refresh tokens. `AuthService.refreshAccessToken` solo chequea
la firma del refresh token y que el usuario siga `active`. Dos consecuencias,
las dos verificadas contra la API local:

- **Cambiar la contraseña no cierra la sesión abierta de esa persona.** Un
  refresh token emitido antes del cambio sigue devolviendo un access token
  nuevo, y vive sus 30 días. `users-page.tsx` lo dice en la pantalla en vez de
  esconderlo: lo que corta el acceso es desactivar, en el próximo refresco.
- **Desactivar y reactivar revive el refresh token viejo.** Mientras está
  desactivado, ese token da 401; al reactivarlo vuelve a dar 200. La
  desactivación no invalida nada, solo tapa la puerta mientras dura.

Sin urgencia mientras corramos local, con un solo usuario real: hoy el que
desactiva y el que se desactiva son la misma persona.

La primera de las dos está fijada por un test, no por un recordatorio:
`auth.int.test.ts`, «resetting a user's password does NOT invalidate a refresh
token already issued». El día que se cierre esta entrada, ese test se pone en
rojo y obliga a cambiar el texto de la pantalla en el mismo commit, en vez de
dejarla mintiéndole al dueño de la planta.

**Para cerrarla:** un `tokenVersion` en `users` que el payload del token
lleve y `refreshAccessToken` compare, incrementado al cambiar la contraseña y
al desactivar; o una tabla de refresh tokens emitidos que se pueda revocar,
que además serviría para «Refresh token en localStorage».

## La web no descarta la petición en vuelo al cambiar de objetivo

**Estado:** abierto, en observación, con **una** aparición confirmada.
**Disparador:** una segunda aparición de verdad.

> **Corrección (28/08/2026).** Esta entrada nació diciendo «van dos
> apariciones en pantallas que no comparten una línea de código», y sobre esa
> cuenta se apoyaba la pregunta de la pieza compartida. Al perseguir el flaky
> de `customers-page` hasta la causa, resultó que esa pantalla **no** era una
> aparición de este patrón. Queda una sola. Ver «Lo que se descartó», al final.

Ninguna pantalla cancela la petición que ya salió cuando el usuario cambia de
objetivo (otra fila, otra página, otro filtro). Lo más que hay es un guard
ad-hoc que decide si la **respuesta** se ignora; la petición sigue viva, y
nada impide que su resultado llegue después del cambio.

La aparición confirmada:

- **`users-page.tsx`, cambiar contraseña.** Tuvo el defecto por dos puertas
  distintas, y necesitó dos arreglos de naturaleza distinta — que es
  justamente lo que hace que valga la pena tener esto escrito.
  1. _Por la fila:_ sus botones se deshabilitaban con `isSavingAction` y no
     con `isResetting`, así que se podía abrir el bloque de otra persona con
     el PATCH de la primera en vuelo; al volver, la respuesta cerraba el
     formulario recién abierto y anunciaba éxito con el nombre equivocado.
     Se cerró deshabilitando también las acciones de la fila mientras dura la
     petición.
  2. _Por los filtros:_ esos no se deshabilitan —mirar otra lista no es
     motivo para congelar la pantalla durante una escritura ajena—, y
     cambiarlos recarga la tabla; la respuesta llegaba después y dejaba el
     aviso de éxito nombrando a alguien que ya no estaba en la lista visible.
     Acá **no** se agregó otro `disabled`: la página cuenta sus cargas de
     lista (`listRunRef`) y la respuesta tardía solo pone el aviso si la tabla
     sigue siendo la misma que cuando se envió.

### Lo que se descartó: `customers-page` no era esto

Se contaba como segunda aparición, y no lo es. La bandera `cancelled` de su
efecto de listado **funciona**: descarta correctamente la respuesta vieja. La
petición de más que se veía en el test no era una respuesta que aterrizaba
tarde, sino una petición nueva y correctamente ejecutada, para una página que
el usuario nunca pidió.

El defecto era **una escritura diferida e incondicional sobre un estado con
varios dueños**: `setPage(1)` dentro del timer del debounce, corriendo aunque
el término de búsqueda terminara igual. Otra familia — ver «Test flaky en
apps/web: customers-page falla bajo carga», ya cerrada.

**Por qué eso descarta la pieza compartida, por ahora.** Lo que se estaba
considerando era un hook de petición con `AbortController` y un solo dueño del
objetivo. Abortar peticiones **no habría arreglado ninguno de los dos casos
que lo motivaron**: en `customers-page` la petición sobrante era legítima
—faltaba no escribir el estado, no cancelar nada—, y en `users-page` el PATCH
tenía que completarse igual, porque la contraseña sí se estaba cambiando; lo
que sobraba era el efecto en pantalla, no la petición. Un refactor de 35
efectos por una premisa que no resuelve ninguno de los dos casos es el tipo de
trabajo que después nadie sabe por qué se hizo.

**El censo, que el día que alguien reabra esto importa más que la conclusión**
(medido el 28/08/2026, en `apps/web/src`):

| Forma                                                  | Cuánta hay                                            | Fallos |
| ------------------------------------------------------ | ----------------------------------------------------- | ------ |
| Bandera `cancelled` en un efecto de carga              | 35 efectos en 22 archivos                             | cero   |
| Debounce que difiere un `setPage(1)`                   | solo `customers-page.tsx`                             | uno    |
| Aviso de éxito que nombra un objetivo, junto a filtros | `users-page` (arreglado) y `container-movements-page` | uno    |

El aviso de `container-movements-page` no está expuesto: es genérico, no
nombra una fila, y vive dentro del mismo formulario que lo produjo.

**Para cerrarla:** si aparece una segunda aparición real —una respuesta que
aterriza sobre estado que ya es de otro objetivo—, volver a plantear la pieza
compartida con los tres casos sobre la mesa. Hasta entonces `users-page` se
queda con sus dos remedios, incluido el `disabled={... || isResetting}`.

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

**Estado:** abierto. **Disparador:** HU-19 (reporte de deuda con antigüedad).

Un pago sin `locationId` (Payment.locationId es opcional, spec: sin locación
el principal paga a nivel del cliente consolidado) puede tener que saldar
deuda acumulada en varias ventas/locaciones a la vez. La regla de negocio
decidida con el cliente: el reparto se hace saldando primero la deuda más
antigua (FIFO por fecha de venta/deuda), con posibilidad de asignación manual
por el usuario cuando el reparto automático no sea el que corresponde (p.ej.
el cliente indica que ese pago es específicamente para una venta puntual).

`PaymentsService.createOfficePayment` (HU-18, cobranza de oficina) ya existe
y ya acepta un pago sin `locationId`, pero decrementa `debtBalance` como un
solo número consolidado — no reparte el monto entre las ventas/locaciones
específicas que lo componen. Es determinista sobre fechas y montos, así que
se puede reconstruir después: no bloqueó HU-18.

**Para cerrarla:** cuando exista HU-19 (la antigüedad de cada deuda por
cliente), implementar el reparto FIFO en `createOfficePayment` como parte de
la lógica de un pago sin `locationId`.

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

**Estado:** RESUELTA — y mal titulada desde el primer día. **No era un test
flaky: era un bug real, y el test lo estaba reportando bien.** Se descartó
cinco veces como ruido de CPU.

**Qué era.** El efecto de debounce del buscador
(`apps/web/src/pages/customers-page.tsx`) llamaba `setPage(1)`
**incondicionalmente** 300 ms después de cada cambio de `searchInput`,
incluido el que se programa en el mount con el campo vacío. Dos consecuencias,
las dos reproducidas de forma determinista antes de tocar nada:

- **Paginar dentro de los primeros 300 ms se pisaba.** Peticiones observadas:
  `page=1`, `page=2`, `page=1` — la tercera no la pidió nadie. Que fallara
  «bajo carga» nunca fue por contención: dependía de dónde cayeran los 300 ms
  respecto del clic y de la aserción, y la carga solo ensanchaba la dispersión
  hasta hacer que la corrida los cruzara.
- **Tipear una letra en el buscador y borrarla sacaba al usuario de la página
  que estaba mirando.** Sin ventana de tiempo ni carrera: el término termina
  igual —`""` a `""`—, `setSearch` no cambia nada, pero `setPage(1)` corre
  igual. Una persona en la oficina que se arrepiente de lo que tipeó pierde el
  lugar donde estaba.

**Qué falló, y no fue el test.** La forma del test estaba bien, incluida la
aserción sobre el registro de peticiones: era exactamente lo que hacía falta
para ver este bug, y es lo único que lo estuvo mirando durante cinco
apariciones. Lo que falló fuimos nosotros, leyendo un rojo verdadero como
ruido de CPU porque pasaba aislado. La entrada anterior llegó a escribir que
«lo más probable» era una espera mal puesta en el test; no lo era, y la
hipótesis nunca se comprobó antes de archivarla.

La lección que vale más que el arreglo: un test que pasa aislado y falla en la
suite no es, por eso, un test malo. Aislado también cambia el reloj.

**Cómo se cerró:** el debounce guarda el último término aplicado y no escribe
nada cuando la búsqueda termina igual que estaba, así que `setPage(1)` corre
solo cuando el término cambió de verdad. Los dos casos de arriba quedaron como
tests permanentes en `customers-page.test.tsx`, cada uno afirmando sobre las
peticiones **y** sobre qué fila se ve; se verificó que los dos fallan sin el
arreglo.

_Texto original de la entrada, tal como se escribió cuando se la creía flaky:_

**Estado (original):** abierto. **Disparador:** antes del piloto de campo.

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

**Evidencia acumulada (28/08/2026):** volvió a fallar cuatro veces durante el
módulo de rutas y el trabajo que le siguió, siempre el mismo caso y siempre
pasando en la corrida inmediatamente posterior sin tocar nada. Cada vez costó
una re-corrida completa de la suite para distinguirlo de un fallo real. La
entrada sigue con el mismo disparador —antes del piloto—, pero ya no es
teórico: es el único test del repo que obliga a preguntarse si el rojo es
verdadero, y por ahora no llegó a fallar en CI solo por suerte de
programación.

## La suite de web roza el timeout de 5 s bajo cobertura

**Estado:** abierto, en observación. **Disparador:** que vuelva a pasar dos
veces seguidas, o que empiece a pasar en CI.

`pnpm --filter @yacco/web test` corre con `--coverage` y en paralelo con la de
api. Bajo esa carga, algún test suelto llega al timeout por defecto de vitest
(5000 ms) y da rojo sin haber evaluado ninguna aserción. Visto tres veces el
28/08/2026, en tres archivos distintos y no siempre los mismos:
`production-page` («un doble clic en registrar dispara un solo POST»),
`customers-page` y `customer-create-page` («muestra el 400 de la API en vez de
tragárselo», 5046 ms). Cada uno pasa aislado en ~1 s, y la corrida siguiente de
la suite completa pasa entera.

**Por qué se anota en vez de ignorarse.** Esta es exactamente la forma que
tenía «Test flaky en apps/web: customers-page falla bajo carga», que se
descartó cinco veces y resultó ser un bug real. La diferencia que sí se puede
verificar: aquel fallaba con **una aserción dando un valor equivocado**
(`'1'` en vez de `'2'`), y este falla por **agotar el tiempo** sin llegar a
evaluar nada. Un valor equivocado es un defecto del código; un timeout puede
ser solo contención. La distinción vale mientras se compruebe cada vez, no
como excusa por defecto: ante un rojo nuevo acá, lo primero es mirar si el
mensaje es una aserción o un timeout.

**Para cerrarla:** medir antes de tocar. Si el costo está en el arranque de
cada archivo (`setup` suma más que `tests` en el reporte, hoy 92 s contra
199 s), la salida no es subir `testTimeout` —que solo esconde el síntoma y
retrasa el rojo real— sino reducir trabajo por archivo o limitar la
concurrencia con `poolOptions`. Subir el timeout sin medir es lo único que
está descartado.

## Doble envío del formulario de cobranza

**Estado:** RESUELTA — `Payment.idempotencyKey` existe desde el PR de
idempotencia de pagos (rama `feat/payment-idempotency`). Se conserva la
entrada como registro de por qué faltaba, con una corrección: la
comparación con `sync_operations` de más abajo decía que `POST
/sync/operations` "sí exige un UUID generado en el dispositivo" — ese
endpoint no existe, solo la tabla `sync_operations`, modelada por
adelantado sin controller ni servicio. La forma de esa tabla (un UUID
generado por el cliente como PK) tampoco era trasladable a `Payment`, cuya
PK ya es `gen_random_uuid()` y ya tiene filas con dinero — ver cómo se
cerró.

`POST /api/v1/payments` (HU-18, cobranza de oficina) no tenía clave de
idempotencia — `Payment` no tenía ninguna columna para eso. Dos clics
rápidos sobre "Registrar pago", o un reintento de red tras un timeout cuyo
primer intento sí llegó a la base, creaban dos filas de `Payment`
idénticas y descontaban `debtBalance` dos veces por el mismo cobro real.

**Razón:** la única defensa era que la UI deshabilite el botón al
enviarlo, que cubre el doble clic pero no el reintento de red — el cliente
nunca sabe si el primer POST llegó a escribir antes de que la conexión se
cortara, así que reintentar es la respuesta razonable y era justo lo que
duplicaba el cobro.

**Cómo se cerró:** columna nueva `Payment.idempotencyKey` (`String?
@unique @db.Uuid`, nullable porque las filas existentes no la tienen y
porque un pago creado por `RoutesService.markStop` no la necesita — esa
parada ya es idempotente por su propio `UPDATE ... WHERE status =
'PENDING'`). `POST /payments` acepta `idempotencyKey` opcional (UUID v4)
en el body:

- Sin clave: sin cambios, cada POST crea un pago nuevo.
- Con clave nueva: crea el pago, responde 201.
- Con clave repetida: no crea nada, responde 200 con el pago RELEÍDO de la
  base (nunca reconstruido del request) — si algo lo cambió entre el
  primer intento y el reintento, el llamador ve ese estado real, no el de
  la creación original.
- Con la misma clave pero otro `customerId` o otro monto: 409, sin tocar
  el pago existente — eso es un error de quien llama, no un reintento
  legítimo.
- Bajo una carrera (dos requests concurrentes con la MISMA clave nueva),
  la garantía real es el índice único de la columna, no la lectura previa:
  el que pierde la inserción atrapa el `P2002` y relee en vez de fallar.

`PaymentsService.createOfficePayment` y
`test/integration/payments.int.test.ts` (describe
`idempotencyKey`) cubren los seis casos de aceptación, incluida la
concurrencia y que la deuda del cliente baja una sola vez tras un
reintento.

## HU-18 E1 solo verificada a medias: falta `GET .../account-statement`

**Estado:** RESUELTA — `GET /api/v1/customers/:id/account-statement` existe
desde el PR de estado de cuenta (rama `feat/customer-account-statement`). Se
conserva la entrada como registro de por qué faltaba.

El criterio de aceptación de HU-18 tiene dos cláusulas: "su deuda disminuye"
y "el abono aparece en el estado de cuenta". Los tests de `POST /payments`
(`payments.int.test.ts`) ya cubrían la primera contra `debtBalance`, pero
`GET /customers/:id/account-statement` no existía en `apps/api/src` —era
solo una fila de la tabla de endpoints previstos en
`docs/yacco-documentacion.md`—, así que la segunda cláusula no tenía dónde
verificarse.

**Cómo se cerró:** `CustomersService.getAccountStatement` reconstruye el
libro desde `Sale`/`Payment` (nunca confía en `debtBalance` directamente) y
`account-statement.int.test.ts` prueba justamente esa reconstrucción: el
`closingBalance` sin filtros de fecha coincide exactamente con
`customers.debtBalance` para un cliente con varias ventas y pagos —incluidos
`PENDING`/`REJECTED`, que aparecen en la lista sin mover el saldo— y también
que un pago de oficina aparece ahí con su monto y estado correctos.

## `requiresConfirmation` usado como proxy de "es efectivo"

**Estado:** abierto. **Disparador:** cuando aparezca un método de pago sin
`requiresConfirmation` que no sea efectivo.

`RouteSettlementService.computeExpected` calcula `totalCashCollected` como
los pagos `CONFIRMED` cuyo método tiene `requiresConfirmation: false`. Hoy
funciona porque Efectivo es el único método sembrado con ese valor — pero
son conceptos distintos: `requiresConfirmation` dice "nadie necesita
verificar que esto llegó", no "esto es plata física que el chofer puede
contar". Si mañana la planta acepta un medio digital instantáneo que la
oficina decida no verificar (por ejemplo, un QR con confirmación
automática del banco), `totalCashCollected` lo contaría como si el chofer
lo trajera en la mano.

**Razón:** no había ningún método así al construir HU-17, así que separar
los dos conceptos habría sido una columna especulando sobre un caso que
todavía no existe — el mismo criterio que ya rige el resto del dominio.

**Para cerrarla:** agregar una columna `isCash` a `PaymentMethod`
(sembrada `true` solo en Efectivo) y que `computeExpected` filtre por ella
en vez de por `requiresConfirmation`.

## Una liquidación puede quedar desactualizada

**Estado:** abierto. **Disparador:** antes del piloto de campo.

`RouteSettlementService.settle` persiste `totalCollected` y
`totalPendingConfirmation` incluyendo los pagos `PENDING` de la ruta en el
momento de liquidar. Si alguno de esos pagos se rechaza después
(`POST /payments/:id/reject`), la liquidación ya escrita sigue afirmando un
cobro que resultó no ser tal — nada la recalcula ni la marca como
desactualizada.

**Razón:** HU-17 pide conciliar al cierre, no mantener la conciliación
sincronizada para siempre; recalcular en cada resolución de pago habría
sido diseñar para un caso sin decidir con el dueño si una liquidación
puede reabrirse (fuera de alcance de este PR: "reabrir o corregir una
liquidación ya registrada").

**Ampliada por la anulación de una parada.**
`SalesService.voidStopDeliveryWithinTransaction` escribe sus movimientos
`*_VOID` colgados de la ruta sin mirar en qué estado está, así que anular
una parada de una ruta ya liquidada deja la fila de `route_settlements`
afirmando llenos entregados y vendidos que el libro ya no sostiene — el
mismo desfase que el pago rechazado, por una puerta más ancha: acá se
mueven envases, no solo dinero. El emisor es el lugar correcto para NO
decidirlo, porque no sabe qué quiere la oficina; quien tiene que resolverlo
es el endpoint de corrección (PR 2b), y las opciones son bloquear la
corrección sobre una ruta `SETTLED`, permitirla marcando la liquidación
como desactualizada, o permitir reabrirla. Es una decisión del dueño, no
del código.

**Para cerrarla:** decidir con el dueño de la planta si una liquidación
liquidada debe reabrirse cuando esto ocurre, o si basta con que el reporte
de cobranza (`GET /reports/collections`, aún no construido) lea el estado
de los pagos en vivo en vez de confiar en el número congelado de la
liquidación.

## Falta índice en `sales (location_id, sold_at)`

**Estado:** abierto. **Disparador:** en el piloto de campo.

`sales` no tiene ningún índice sobre `location_id` ni `sold_at` — solo la
PK y el índice parcial de `external_id`. `GET /customers/:id/account-statement`
(`CustomersService.getAccountStatement`) recorre `sales` filtrando por
`location: { customerId }`, un join sin índice de apoyo del lado de `sales`.

**Razón:** con el volumen actual (planta con un solo cliente de referencia
en desarrollo) el costo de un `sequential scan` es nulo, y agregar un
índice especulando sobre un volumen que todavía no existe habría sido el
mismo error que el proyecto evita en el resto del dominio. Este PR ya tenía
bastante superficie (un endpoint nuevo que reconstruye dos tablas) como
para sumarle una migración de índice sin necesidad demostrada.

**Para cerrarla:** cuando el piloto de campo traiga volumen real de
ventas, medir el plan de `GET .../account-statement` y agregar
`@@index([locationId, soldAt])` en `Sale` si el `EXPLAIN` lo justifica —
mismo criterio que ya aplicó `payments (customer_id, paid_at DESC)` en el
PR de cobranza de oficina.

## Un pedido asignado a una parada sigue en PENDING

**Estado:** resuelta. `Order.status` sigue a su parada, que es lo que HU-10 E1
pedía.

> **Consecuencia descubierta después de cerrarla:** al seguir el pedido a su
> parada, una parada que quedaba `PENDING` con la ruta ya `FINISHED` dejaba su
> pedido en `ON_ROUTE` sin ninguna salida. Ver «Terminar una ruta no exigía sus
> paradas resueltas», más abajo, que es donde se cerró.

**Cómo se cerró.** Cuatro escrituras, cada una DENTRO de la transacción de la
operación que la causa —nunca en una segunda transacción ni después de
responder—, y ninguna toca una parada de origen `VAN_SALE`, que no tiene
pedido:

| Operación                | El pedido queda |
| ------------------------ | --------------- |
| `addStop` (origen ORDER) | `ON_ROUTE`      |
| `markStop` → DELIVERED   | `DELIVERED`     |
| `markStop` → FAILED      | `FAILED`        |
| `removeStop`             | `PENDING`       |

`markStopFailed` pasó a ser transacción para esto: era un `updateMany` suelto
porque no había nada más que escribir junto al flip de la parada.

**Las tres decisiones de dominio que quedaron fijadas:**

- **`ON_ROUTE` se escribe al asignar la parada, no al iniciar la ruta.** HU-10
  E1 lo dice en el momento de la asignación, y hacerlo en `start()` dejaría una
  ventana en la que un pedido ya planificado se puede cancelar mientras el
  chofer lo lleva en la hoja de ruta.
- **Una parada FAILED deja el pedido en FAILED, nunca de vuelta en PENDING.**
  `Order.deliveryDate` es una fecha de negocio: reintentar mañana es otro día de
  entrega y se registra como un pedido nuevo. Volver a PENDING haría que un
  pedido fallado tres veces se viera idéntico a uno recién tomado.
- **`removeStop` devuelve el pedido a PENDING, y es obligatorio.** Sin eso
  `removeStop` rompe su propio contrato documentado —«libera el pedido»—,
  porque `addStop` exige PENDING y el pedido quedaría inasignable para siempre.

**Lo que esto destrabó de paso:** la guarda `WHERE status = PENDING` de
`OrdersService.cancel` estaba escrita desde siempre y era **inerte**. Su
docblock decía que existía para no cancelar un pedido «que ya está ON_ROUTE»,
pero como nadie escribía ese estado, la oficina podía cancelar un pedido que
iba en el camión, y también uno ya entregado.

**Qué quedó fijado por test** (integración, contra Postgres real): las cuatro
transiciones, que `GET /orders?status=ON_ROUTE` devuelve el asignado, que un
pedido liberado se puede reasignar a otra ruta, y que una parada `VAN_SALE` no
toca ningún pedido en ninguna de las cuatro operaciones.

El test que fija el agujero es «refuses to cancel an order a route already
picked up», en `orders.int.test.ts`. **Existía y no servía**: simulaba el
`ON_ROUTE` con una escritura directa de Prisma, así que pasaba igual con el
agujero abierto. Ahora arma la ruta y asigna la parada de verdad, y falla si
alguien revierte la escritura de `addStop`.

_Texto original de la entrada, tal como se escribió cuando estaba abierta:_

**Estado (original):** abierto. **Disparador:** cuando la oficina necesite ver
en la lista de pedidos cuáles ya están arriba del camión.

HU-10 E1 dice, textual: «los pedidos asignados pasan a "en ruta"».
`RoutesService.addStop` no toca `Order.status`, y `OrderStatus.ON_ROUTE` no
se escribe en ningún punto de `apps/api/src` (verificado con `grep`): un
pedido con parada asignada se queda PENDING para siempre, y también sigue
PENDING después de que su parada se marque DELIVERED. La pantalla de pedidos
lo muestra como «Pendiente» aunque ya se haya entregado.

**Razón:** se encontró leyendo el módulo de rutas para construir sus
pantallas, no persiguiéndolo. No bloquea nada de lo construido: el selector
de pedidos de una parada filtra por `status=PENDING` **y** por «sin parada
asignada» (`hasRouteStop=false`), que es exactamente la condición que
`addStop` acepta, así que la lista ofrecida y la lista aceptada coinciden.
Cambiar la transición sí tocaría reglas de dominio ya codificadas y el
significado de `OrderStatus` en toda la app, que es más de lo que
correspondía a un PR de pantallas.

**Para cerrarla:** decidir con el dueño de la planta si un pedido asignado
debe verse «En ruta» en la bandeja de pedidos, y en ese caso mover
`Order.status` a ON_ROUTE dentro de la misma transacción que crea la parada
(y a DELIVERED/FAILED al marcarla), o corregir HU-10 E1 en la spec si la
decisión es que el estado del pedido no siga a la parada.

## Terminar una ruta no exigía sus paradas resueltas

**Estado:** resuelta.

**Qué pasaba.** `RoutesService.finish` tenía dos guardas —dueño de la ruta y
`WHERE status = IN_PROGRESS`— y ninguna miraba las paradas. Una ruta con una
parada todavía `PENDING` pasaba a `FINISHED` sin decir nada.

**Por qué era una trampa y no un descuido cosmético.** Desde que el pedido
sigue a su parada («Un pedido asignado a una parada sigue en PENDING», arriba),
esa parada pendiente arrastra un pedido en `ON_ROUTE`, y con la ruta terminada
las tres salidas están cerradas, cada una por su propia guarda:

| Salida                 | Su guarda                                      | Por qué no aplica |
| ---------------------- | ---------------------------------------------- | ----------------- |
| `markStop`             | `route.status === IN_PROGRESS`                 | la ruta terminó   |
| `removeStop`           | `assertRouteIsTouchable` (PLANNED/IN_PROGRESS) | la ruta terminó   |
| `OrdersService.cancel` | pedido `PENDING`                               | está `ON_ROUTE`   |

Y nada en `apps/api/src` devuelve una ruta a `IN_PROGRESS`. El pedido quedaba
congelado para siempre: ni entregado, ni fallado, ni cancelable.

**La decisión del dueño de la planta fue bloquear**, no autocompletar las
paradas ni liberar los pedidos. Autocompletar inventaría un hecho de campo que
nadie observó; liberar el pedido lo devolvería a la bandeja como si nunca
hubiera salido en un camión.

**Por qué bloquear no contradice «avisa, no bloquea».** Esa filosofía —el
límite de crédito advierte, una liquidación descuadrada cierra igual, un saldo
de envases puede quedar negativo— es para **juicios de negocio**, donde el dato
incómodo se registra en vez de suprimirse. Esto es la **máquina de estados**: no
hay ningún dato que registrar, solo un pedido sin salida. Bloquear acá es lo
mismo que ya hacen `start()` con una ruta no planificada o `cancel` con un
pedido no pendiente. La distinción está escrita en el docblock de `finish`, no
solo acá.

**Cómo se cerró.** La guarda vive DENTRO del `WHERE` del `updateMany`
(`stops: { none: { status: PENDING } }`), igual que la de estado, no en una
lectura previa que una llamada concurrente pueda adelantar. Con `count === 0`
hay dos causas, así que una lectura desambiguadora —el mismo idioma que
`throwAlreadyMarkedConflict`— relee el estado y cuenta las paradas pendientes
para que el 409 nombre la verdadera. El mensaje nuevo usa el vocabulario de la
planta («entregada o no entregada», el de `STOP_STATUS_LABELS`) y **no**
interpola ningún enum. En la web, el diálogo de «Terminar ruta» dejó de ofrecer
confirmar cuando quedan paradas: explica cuántas faltan y qué hacer con cada
una, y su único botón es «Entendido».

**Lo que queda abierto a conciencia:** la carrera del subquery. El filtro de
relación no bloquea las filas de `route_stops`, así que un `addStop` que
confirme dentro de la ventana entre el subquery y el UPDATE puede dejar una ruta
`FINISHED` con una parada `PENDING`. Es la misma clase que ya tiene `addStop`,
cuya lectura de «ruta tocable» también vive fuera de su transacción, y cerrarla
pide un lock sobre las paradas de la ruta en las dos operaciones. Con una sola
oficina agregando paradas no se paga ese precio hoy; el disparador es el mismo
que el de «Sin lock sobre customer_container_balances»: que el piloto traiga
varias personas operando la misma ruta a la vez.

**Efecto en la liquidación, que no se tocó:** `unresolvedStops` de
`getSettlementView` pasa a ser estructuralmente `0` para toda ruta terminada de
acá en adelante. El aviso de la pantalla de liquidación **se queda**: sigue
sirviendo para las rutas ya terminadas antes de este cambio, que son las únicas
que pueden traer paradas sin resolver.

**Una ruta sin paradas se puede terminar**, y es deliberado: `none` es cierto
sobre el conjunto vacío, y una ruta que nunca tuvo paradas no congela ningún
pedido.

## Los datos de demo no tienen profundidad temporal en el libro

**Estado:** abierto. **Disparador:** cuando haga falta demostrar, o probar a
mano, cualquier pantalla que agrupe o filtre por `occurred_at`.

**No es solo la pantalla de cuadre.** Afecta a todo lo que mire el instante de
un movimiento en vez de la fecha de negocio de su ruta: el historial de
`container-movements-page` con sus filtros de fecha, cualquier reporte por
periodo que se construya sobre el ledger, y el filtro «contadas antes del» de
`container-counts-page`, que es donde se descubrió.

`seed-demo.ts` crea las rutas con su fecha de negocio —cinco días hacia
atrás— pero el `occurred_at` de cada movimiento es el instante en que corrió el
CLI, porque los servicios lo estampan con `now()` y la API pública no acepta
otra cosa. Los cinco días de historia son cinco días en `routes.date` y **un
solo instante** en `container_movements`. Lo mismo con los conteos:
`CreateContainerCountDto` no acepta fecha a propósito —su docblock dice que
retrodatar existe solo para el cargador de padrón—, así que los tres conteos de
la demo caen juntos y «contadas antes del» no puede devolver un subconjunto que
signifique algo.

**Qué costaría arreglarlo:** pasar el CLI de HTTP puro al patrón de
`load-roster.ts`, que levanta un contexto de Nest
(`NestFactory.createApplicationContext`) y llama a los servicios en proceso,
donde `createWithinTransaction` y `ContainerCountsService.create` ya aceptan
`occurredAt`. La capacidad existe; lo que falta es alcanzarla.

**Qué se perdería, y hay que saberlo antes de tomarla:** hoy cada
`pnpm demo:data` ejercita los endpoints públicos de punta a punta —login,
catálogos, alta de clientes, lote, ruta, carga, paradas, entregas con cobro,
conteos— y es el único humo que este repo tiene sobre el flujo de despacho, que
no tiene pantalla web (ver `docs/estado-por-modulo.md`). El propio docblock de
`seed-demo.ts` lo dice. Cambiar a llamadas en proceso **elimina esa
verificación**: un 400 nuevo en `POST /routes/:id/stops/:stopId` dejaría de
aparecer al sembrar. Quien tome esta entrada está pagando ese precio, no solo
ganando fechas.

Una salida intermedia, si el precio no vale: dejar el sembrado por HTTP y
agregar un paso final, en proceso, que solo retroceda `occurred_at` de lo ya
escrito. Feo —toca un ledger inmutable— pero acotado, y no toca la ruta pública.

## Seis mensajes de RoutesService interpolan el enum crudo

**Estado:** abierto. **Disparador (reescrito el 29/08/2026):** el primer PR que
arme pantallas donde alguno de estos seis errores sea alcanzable a mano, o
cualquier PR que **cambie el texto** de alguno de los seis.

> El disparador anterior decía «el próximo PR que toque `RoutesService`». El PR
> de «Terminar una ruta no exigía sus paradas resueltas» lo tocó y **no** cerró
> la deuda: se difirió a propósito, y queda escrito acá en vez de ignorarse en
> silencio. Es otra tarea —dos mapas de labels (`RouteStatus` y `StopStatus`),
> seis mensajes y los tests que fijan cada texto—, y meterla en un PR que va
> sobre la máquina de estados habría mezclado dos diffs que se revisan distinto.
> Un disparador que se cumple y se ignora sin decirlo enseña a ignorar
> disparadores; por eso el nuevo se dispara con lo que sí obliga a mirar estos
> textos, y no con tocar el archivo.
>
> Ese PR agregó un séptimo mensaje a `finish` —el de las paradas sin resolver—
> que **no** interpola ningún enum: usa «entregada o no entregada», el
> vocabulario de `STOP_STATUS_LABELS`. La deuda no creció.

Incumplen la regla de «los mensajes de error que llegan a pantalla van en
español», más abajo: están redactados en español pero terminan con el nombre
del enum, que no significa nada para quien lo lee. La oficina ve «esta está en
IN_PROGRESS» donde el badge de la misma pantalla dice «En curso».

En `apps/api/src/modules/routes/routes.service.ts`:

- `Solo se puede iniciar una ruta planificada; esta está en ${route.status}`
- `Solo se puede terminar una ruta en curso; esta está en ${route.status}`
- `Solo se puede quitar una parada pendiente; esta está en ${stop.status}`
- `Solo se pueden marcar paradas de una ruta en curso; esta está en ${route.status}`
- `Solo se puede corregir una carga mientras la ruta está planificada; esta está en ${route.status}`
- `No se pueden ${action} de una ruta en estado ${status}`

**Para cerrarla:** el patrón ya existe, es `ORDER_STATUS_LABELS` en
`orders.service.ts` — un mapa `Record<Enum, string>` con las mismas palabras
que usa el badge de la web, conjugado para caer después de «esta está». Hacen
falta dos, uno para `RouteStatus` y otro para `StopStatus`. Con tres mapas en
dos módulos probablemente convenga un solo lugar; con uno no hacía falta
inventarlo.

Y el texto se fija por test, como se hizo con los de `users` y con el 409 de
`cancel`: sin eso nada impide que el próximo cambio vuelva al enum.

## Descargar los vacíos al volver de ruta no tiene camino en la app

**Estado:** resuelta. **La liquidación es el productor automático de
`EMPTY_UNLOAD`**: al liquidar, cada tipo de envase contado en la puerta vuelve
al galpón con su propio movimiento (`EMPTY_ON_ROUTE` -> `EMPTY_AT_PLANT`),
dentro de la misma transacción que cierra la ruta.

**Cómo se cerró.** `emptiesCollected` dejó de ser un entero y pasó a ser un
desglose por tipo de envase —un movimiento siempre nombra de qué tipo es, así
que un total no alcanzaba para escribirlo—. No hizo falta migración:
`empties_collected` sigue guardando el total y el desglose se reconstruye del
ledger, por la misma razón por la que `differences` se calcula y no se
persiste. La pantalla de liquidación cuenta ahora una línea por tipo, con lo
que dice el libro al lado y la diferencia mientras se escribe.

**Se emite desde lo CONTADO, no desde el libro**, y de ahí sale la
consecuencia que se acepta a conciencia: no hay ninguna guarda de stock sobre
`EMPTY_ON_ROUTE` —las que existen son sobre llenos—, así que si el chofer
devuelve 40 de un tipo y el libro registró 34, el parque queda en −6 para ese
tipo. **Ese negativo es la información**: dice que hay seis recogidas que nadie
registró. Es el mismo razonamiento que ya rige el saldo negativo de un cliente
(«CHECK de no negatividad en customer_container_balances», arriba), y está
fijado por un test de integración para que nadie lo «arregle» más adelante.

**Lo que se descartó, y por qué.** La alternativa barata que esta entrada
proponía —agregar `EMPTY_UNLOAD` a `AllowedMovementType` para que la oficina lo
cargara a mano desde la pantalla de movimientos— quedó afuera: habría **dos
productores del mismo evento diario** y ninguna forma de saber cuál lo mandó, y
descargar el camión no es una decisión que alguien tome cada tarde, como sí lo
son una baja por daño o por pérdida. Los otros tres tipos sin productor
automático (`FLEET_ENTRY`, `DAMAGE_WRITE_OFF`, `LOSS_WRITE_OFF`) siguen siendo
manuales, y eso sigue estando bien.

El seed de demo liquida todas sus rutas menos la última, así que el inventario
ya no abre con los vacíos de las jornadas cerradas varados en el camión.

_Texto original de la entrada, tal como se escribió cuando estaba abierta —su
tabla dice «productor automático: ninguno» para `EMPTY_UNLOAD`, que es
justamente lo que este cierre cambió:_

> **Corrección (29/08/2026).** Esta entrada decía que `EMPTY_UNLOAD` era «el
> único tipo de movimiento sin productor» y que no se podía registrar «por
> ningún endpoint». Las dos cosas eran falsas, y la conclusión se apoyaba en
> ellas. Reescrita sobre lo verificado.

**Lo que sí es cierto.** Cuatro de los doce tipos no tienen productor
automático —ningún servicio los emite— y los cuatro se pueden registrar a mano
por `POST /api/v1/container-movements`, que solo rechaza `OPENING_BALANCE` y
`COUNT_ADJUSTMENT` (`INTERNAL_ONLY_MOVEMENT_TYPES`):

| Tipo               | Productor automático | Lo ofrece la web | Cada cuánto ocurre |
| ------------------ | -------------------- | ---------------- | ------------------ |
| `FLEET_ENTRY`      | ninguno              | sí               | al comprar parque  |
| `DAMAGE_WRITE_OFF` | ninguno              | sí               | a veces            |
| `LOSS_WRITE_OFF`   | ninguno              | sí               | a veces            |
| `EMPTY_UNLOAD`     | ninguno              | **no**           | **todos los días** |

**Dónde está la omisión, y por qué el contraste la demuestra.** Que dar de baja
un envase por daño o por pérdida sea manual es una decisión, no un olvido: pasa
de vez en cuando, alguien tiene que mirarlo y decidirlo, y por eso
`container-movements-page.tsx` les da un formulario. Lo mismo el alta de parque
nuevo. Descargar los vacíos al volver de ruta no es de esa familia: ocurre al
cierre de **cada** ruta, todos los días, y no tiene ni camino automático ni
formulario — `AllowedMovementType` en
`apps/web/src/lib/container-movement-transitions.ts` lista exactamente los otros
tres. Un evento diario que solo se puede registrar con un `curl` no está
resuelto.

Que `EMPTY_UNLOAD` tenga etiqueta en `container-movement-labels.ts` («Descarga
de vacíos») y aparezca en el historial refuerza el punto: el sistema sabe
nombrar el movimiento, pero no tiene por dónde producirlo.

**Consecuencia hoy:** todo lo que el chofer recoge en una parada
(`EMPTY_PICKUP`) se queda en `EMPTY_ON_ROUTE`. Con los datos de demo el
inventario abre con 34 «Con caño» y 3 «Sin caño» en camión. En la planta real
esos envases vuelven al galpón el mismo día y se vuelven a llenar.

Se encontró al sembrar devoluciones en la demo (#112): antes no había ningún
`EMPTY_PICKUP`, así que el agujero no tenía cómo notarse.

**Para cerrarla:** decidir dónde se registra la descarga, sabiendo que el
endpoint ya existe y que lo que falta es el camino. El lugar natural es la
liquidación de ruta —`route-settlement` ya cuenta los `EMPTY_PICKUP` del libro
contra el conteo físico de la puerta— pero hoy liquida sin emitir el movimiento
que devolvería esos vacíos al stock. La alternativa barata es agregar
`EMPTY_UNLOAD` a `AllowedMovementType` y que la oficina lo registre a mano como
un write-off, que es tratar un evento diario como si fuera excepcional. Es una
decisión de dominio.

## Devolver llenos al galpón no repone el lote del que salieron

**Estado:** abierto. **Disparador:** antes del piloto de campo, o cuando el
conteo físico de llenos en planta no cierre contra la suma de
`batch_items.available_qty`.

Al liquidar, `fullReturned` se guarda como número y **no emite ningún
movimiento**: los llenos que vuelven sin entregar se quedan, para el libro, en
`FULL_ON_ROUTE`. Quedó explícitamente afuera del PR que hizo que la liquidación
emitiera los `EMPTY_UNLOAD` («Descargar los vacíos al volver de ruta no tiene
camino en la app», arriba), y no por alcance: **no es simétrico con los
vacíos**.

Un vacío que vuelve al galpón no pertenece a ningún lote —un vacío es un vacío—
así que `EMPTY_ON_ROUTE -> EMPTY_AT_PLANT` es todo lo que hay que escribir. Un
lleno que vuelve sí: salió de un `batch_item` concreto, con su
`available_qty` decrementado en el `ROUTE_LOAD`, y devolverlo al galpón sin
reponer ese contador dejaría stock que existe físicamente y no se puede volver
a cargar en ninguna ruta. **Y el ledger no dice de qué lote salió cada envase
que está en el camión:** `container_movements` guarda `batchId` en el
`ROUTE_LOAD`, pero una ruta puede haber cargado de varios lotes, y nada
atribuye los llenos que sobran a uno u otro. Reponer exige decidir esa
atribución primero — FIFO inverso, proporcional, o preguntándoselo a quien
liquida.

`RoutesService.removeLoad` ya resuelve el caso fácil, y por eso mismo se ve
que este no lo es: ahí se corrige UNA carga concreta, con la ruta todavía
PLANNED, así que el lote es conocido y la reposición es exacta
(`availableQty` + `FULL_RETURN`). Acá lo que vuelve es un sobrante de la ruta
entera, después de operar.

**Para cerrarla:** decidir con el dueño de la planta la regla de atribución de
lote de los llenos que vuelven, y recién entonces emitir el `FULL_RETURN`
(`FULL_ON_ROUTE -> FULL_AT_PLANT`) con la reposición de `available_qty` dentro
de la misma transacción de `settle`. Hasta entonces `fullReturned` sigue siendo
un número que se registra y se concilia, no un movimiento.

## Regla: los mensajes de error que llegan a pantalla van en español

**Estado:** resuelta, y anotada acá porque no había dónde mirarla.

La web muestra el mensaje del backend **tal cual** —decisión deliberada, la
misma que explica la entrada de abajo— así que el mensaje de una excepción HTTP
no es código: es texto que lee una persona, y va en español como cualquier otro
texto de interfaz. Los identificadores, los nombres de las excepciones y los
comentarios siguen en inglés; la regla de idioma no cambia.

La pregunta para el próximo módulo es **si el mensaje puede terminar en
pantalla**. Si solo va a un log o solo lo lee quien mantiene la API, puede
quedarse en inglés.

`users.service.ts` era el único módulo que la incumplía —sus cuatro mensajes
estaban en inglés mientras los `message:` de sus propios DTOs ya estaban en
español—, y el caso alcanzable y frecuente era el 409 del alta con un nombre de
usuario repetido. Corregido; la regla vive también en el docblock de
`UsersService`, y los tres mensajes con guarda propia tienen su texto fijado por
test, no solo la clase de excepción.

## Los errores de rutas escriben la fecha en formato ISO

**Estado:** RESUELTA. `RoutesService.create` formatea la fecha con
`formatBusinessDateForMessage` (`DD/MM/AAAA`, partiendo el texto y nunca a
través de `Date`), y hay test unitario y de integración que afirman las dos
mitades: que el mensaje dice `05/09/2026` y que **no** dice `2026-09-05`.

Al cerrarla se verificó el alcance real, que era más chico de lo que la
entrada sugería: recorriendo `apps/api/src/modules/**/*.service.ts`, ese es
el **único** mensaje de toda la API que interpola una fecha de negocio. Los
demás hablan de fechas sin nombrar ninguna («La fecha desde no puede ser
posterior a la fecha hasta», «La fecha del pago no puede ser futura»), así
que no hay nada más que convertir. Por eso el ayudante vive junto a su único
llamador en vez de en un módulo común: se muda el día que aparezca el
segundo.

_Texto original de la entrada, tal como se escribió cuando estaba abierta:_

**Estado (original):** abierto. **Disparador:** cuando el dueño de la planta
reporte que un mensaje de error «habla en otro idioma».

Los 400 de `RoutesService.create` interpolan la fecha tal como llegó en el
cuerpo: «El chofer "Julio Ramírez" ya tiene una ruta planificada para el
2026-08-28». La web muestra el mensaje del backend tal cual —decisión
deliberada, para que no se despegue del que mantiene la API— así que el
usuario ve `2026-08-28` en una pantalla donde todas las demás fechas dicen
`28/08/2026`.

**Razón:** se vio en el navegador al probar el alta duplicada. Es cosmético
y no confunde sobre qué día se habla; arreglarlo del lado de la web
significaría parsear el mensaje del servidor, que es peor.

**Para cerrarla:** que la API formatee la fecha de negocio en los mensajes
dirigidos a personas (`DD/MM/AAAA`), en `RoutesService` y en cualquier otro
servicio que interpole una fecha de negocio dentro de un mensaje de error.

## El aviso de inventario negativo diagnostica una causa que puede no ser la real

**Estado:** abierto. **Disparador:** la próxima vez que una liquidación deje un
tipo en negativo y alguien lea el aviso; a más tardar, antes del piloto de campo.

La página de inventario no se limita a señalar el negativo: le atribuye una
causa. El banner (`apps/web/src/pages/inventory-page.tsx:89-90`) dice «Hay
valores negativos: se registraron más envases llenados que vacíos disponibles.
Faltan registrar entradas de envases», y la celda repite el diagnóstico para
lectores de pantalla (`:156`: «hay más envases llenados que vacíos registrados,
faltan registrar entradas de envases»).

Esa es UNA causa posible, y desde #116 ya no es la única. Reproducido en el
navegador: liquidar una ruta contando MÁS vacíos de un tipo que los que el libro
esperaba deja «Vacíos en camión» (`EMPTY_ON_ROUTE`) en negativo para ese tipo.
Lo dice el propio código que lo produce
(`apps/api/src/modules/route-settlement/route-settlement.service.ts:310-315`):
el `EMPTY_UNLOAD` se emite desde lo contado en la puerta y no desde el libro,
sin guarda de stock sobre `EMPTY_ON_ROUTE`, «así que si el chofer devuelve 40 de
un tipo y el libro registró 34, el parque queda en −6 para ese tipo».

Nada de eso tiene que ver con producción ni con entradas de envases faltantes.
El negativo es correcto y es exactamente la información que se quiere ver —la
aritmética del parque sigue cuadrando, y `hasNegativeQuantity` lo detecta por
estado y por total (`apps/web/src/lib/container-inventory.ts:71-75`)—; lo que
está mal es la explicación que lo acompaña. El dueño que lea el aviso va a ir a
registrar entradas que no faltan, y el negativo va a seguir ahí.

**Para cerrarla:** que el aviso describa el hecho sin atribuirle causa, o que
distinga por estado —un negativo en `EMPTY_AT_PLANT` o `FULL_AT_PLANT` sí sugiere
entradas sin registrar; uno en `EMPTY_ON_ROUTE` apunta a una liquidación que
contó de más—. Cuál de las dos, se decide después de la demo: puede que al dueño
le sirva más una sola frase neutra que dos diagnósticos.

## Los textos de diferencia de la liquidación no concuerdan en singular

**Estado:** abierto. **Disparador:** la próxima diferencia de una sola unidad en
una liquidación, que es el caso más común de todos.

`apps/web/src/pages/route-settlement-page.tsx` elige entre «faltan» y «sobran»
mirando solo el signo, y deja el verbo en plural siempre. Son tres lugares con la
misma forma —`{empties > 0 ? "faltan" : "sobran"} {Math.abs(empties)}`—: el aviso
previo al cierre, para llenos (`:505`) y para vacíos (`:511`), y
`describeTypeDifference`, que anota la diferencia de cada tipo en la vista de
resultado (`:534`).

Observado en pantalla, liquidando con un vacío de más: «-1: sobran 1 respecto del
libro». Con la diferencia en el otro sentido diría «faltan 1».

La regla ya existe en el repo, y no hace falta ir lejos a buscarla: este mismo
archivo la aplica 240 líneas más arriba, en el aviso de paradas sin resolver que
entró con #115 (`:266-267`, «Queda 1 parada» frente a «Quedan N paradas»). Es la
pantalla la que no se sigue a sí misma.

**Para cerrarla:** concordar el verbo con la magnitud en los tres lugares
(«falta 1» / «sobra 1» / «faltan 2»), preferentemente en un solo ayudante que
arme la frase entera, porque el ternario está repetido tres veces y la entrada de
abajo pide la misma frase en un cuarto lugar.

## La columna «Diferencia» del formulario de conteo se lee al revés sin la palabra

**Estado:** abierto. **Disparador:** la primera vez que alguien corrija un conteo
para «arreglar» un número que estaba bien.

`apps/web/src/lib/difference.ts` formatea con signo, y el signo es
esperado − contado: lo fija
`apps/web/src/components/settlement-empties-count.tsx:67`
(`const difference = parsed === null ? pickedUp - 0 : pickedUp - parsed`). Con
ese orden, «+2» significa **faltan 2**.

El formulario imprime ese valor pelado bajo un encabezado que solo dice
«Diferencia» (valor en `settlement-empties-count.tsx:86`, encabezado en `:57`).
Observado: con el libro esperando 3 y un conteo de 1, la fila muestra «+2», que
un lector natural interpreta como dos de más.

La vista de RESULTADO sí agrega la palabra —`route-settlement-page.tsx:534`
imprime «+2: faltan 2 respecto del libro»—, así que la asimetría quedó al revés
de lo útil: el formulario es donde se decide qué número escribir, y el resultado
es donde ya no se puede hacer nada.

El comentario de `difference.ts:2-3` defiende el signo como información —«un
faltante y un sobrante son dos hallazgos distintos y la pantalla nunca los mezcla
en un valor absoluto»— y tiene razón. Esta entrada **no** pide volver al valor
absoluto: pide la palabra al lado del signo.

**Para cerrarla:** que la celda del formulario diga «+2: faltan 2» / «-2: sobran
2», con la concordancia de singular que pide la entrada de arriba, y que salga
del mismo ayudante que las tres frases de `route-settlement-page.tsx`. Hoy
`formatDifference` da el signo y cada llamador arma la frase por su cuenta.
