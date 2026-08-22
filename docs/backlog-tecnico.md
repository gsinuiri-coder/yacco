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
