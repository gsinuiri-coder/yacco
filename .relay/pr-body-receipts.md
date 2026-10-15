# Comprobantes registrados

Fila 8 de la Fase 3: registrar boletas, facturas y notas de crédito ya
emitidas (talonario o electrónico fuera de Yacco), con sus ventas, adjuntos
privados y auditoría. No emite nada a SUNAT; la emisión y las guías quedan en
su propia fila.

## Resumen

- **Datos de facturación** versionados (solo ADMIN): RUC, razón social,
  dirección fiscal, tasa de IGV y monto desde el cual la boleta exige
  documento. Cada comprobante guarda la versión con que se registró.
- **Registrar comprobante** (ADMIN y SELLER) sobre una o varias ventas
  enteras del mismo cliente; total = suma de las ventas, base por renglón e
  IGV que cuadra el total, todo `NUMERIC(10,2)` y montos como texto. Vista
  previa antes de guardar. Factura exige RUC; boleta exige documento desde el
  umbral. Aviso (no bloqueo) por forma de serie.
- **Una venta, a lo sumo un comprobante vigente** (índice único parcial en
  `receipt_sales` sobre `released_at IS NULL`); anular una venta comprobada
  se rechaza, también desde el cobro de un accesorio.
- **Anular** (solo ADMIN, con motivo) y **nota de crédito** (ADMIN y
  SELLER): el original queda a la vista como anulado y sus ventas se liberan
  una sola vez, con quién y cuándo.
- **Corrección de las 20:00**: una nota de crédito solo se anula si es
  manual, y la anulación la marca solo a ella; el original sigue anulado y se
  restaura con «Volver a registrar el original» (mismo número, mismas ventas,
  y opcionalmente los mismos adjuntos sin volver a subirlos). Una nota
  electrónica no se anula.
- **Decisiones de las 21:25**: volver a registrar el original libera una
  marca «No lleva comprobante» de sus ventas, como cualquier alta (la web
  ahora ofrece esas ventas); la API rechaza volver a registrar un papel cuya
  nota de crédito sigue vigente; los adjuntos solo se reasocian desde un
  anulado del mismo cliente con el mismo tipo, serie y número (el medio puede
  cambiar); anular el cobro de un accesorio pasa por `SalesService` y anula
  también sus pagos.
- El detalle trae `canRegisterAgain` y `registeredAgainId`: la web deja de
  ofrecer «Volver a registrar el original» cuando el papel ya está vigente
  otra vez (y enlaza al vigente) o sigue anulado por una nota vigente.
- **Tipo, serie y número únicos solo entre los vigentes** (decisión 1).
- **«No lleva comprobante»**: marca inmutable con motivo; se libera a mano
  (ADMIN) o al registrar un comprobante.
- **Adjuntos** privados en almacenamiento de objetos, servidos solo con
  sesión.
- Web: «Datos de facturación», «Comprobantes» con filtros, detalle con
  ventas, archivos, notas de crédito y auditoría, «Registrar comprobante» y
  la sección de comprobantes en la ficha del cliente, con `UTable` de Nuxt UI.

## Esquema y migraciones

- `20261014020000_receipt_enums`, `20261014020100_receipts` y
  `20261014082300_receipt_file_audit` son aditivas.
- `receipt_files.created_at` y `created_by` (nullable, llenadas siempre por
  el servicio) se agregaron con la **autorización fija de columnas de
  auditoría** de Giancarlo (2026-10-14 08:21), en una migración nueva sin
  editar la ya aplicada.
- `20261014200000_receipts_active_series_number` reemplaza el índice único
  `receipts_type_series_number_key` por uno parcial `WHERE voided_at IS NULL`:
  es la única excepción a «nada de DROP» autorizada para esta fila (decisión 1
  de las 19:43). Afloja una restricción; no toca columnas ni tablas.
- `schema.prisma` sin reformateo: contra `main` son 120 líneas agregadas y
  ninguna cambiada.
- Fuera del dominio: `test/integration/support/test-storage.ts` se
  reorganizó para que los tests de comprobantes levanten su propio bucket, y
  `customer-contacts-photos.int.test.ts` pasó a usarlo. Se queda en este PR:
  sacarlo dejaría dos copias del mismo arranque de MinIO.
- Sin esquema nuevo para las decisiones de las 21:25.

## Gates

`pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm prisma:validate` verdes.
`pnpm test`: API 1444, web 640, shared 44, firestore-export 54.
`pnpm test:integration` entero, después del último cambio de producción:
`Test Suites: 44 passed, 44 total` / `Tests: 787 passed, 787 total`. Revisión visual con
Playwright: no se hizo en esta corrida desatendida.

## Evidencia TDD de las decisiones de las 21:25

Rojo de la API, unit de `receipts.service.test.ts`, antes de cambiar
`receipts.service.ts`:

```text
pnpm test -- src/modules/receipts/receipts.service.test.ts
  ● … registering again with the original's files › rejects another customer's original before writing anything
  ● … › rejects an original of another type before writing anything
  ● … › rejects a credit note before writing anything
  ● … › rejects an original of another series before writing anything
  ● … › rejects an original of another number before writing anything
  ● … › the same paper loaded under another medium still takes its files
  ● … › an original whose credit note is still live cannot be registered again
    Received promise resolved instead of rejected
Tests:       8 failed, 18 passed, 26 total
```

(El octavo, «copies each file row…», falló porque el original del test ya no
trae `medium` y el código viejo lo exigía.) Verde: 49/49.

Rojo de integración, con producción revertida a mano (sin el chequeo de nota
vigente, sin el chequeo de papel en los adjuntos y sin liberar marcas al
registrar):

```text
pnpm test:integration -- test/integration/receipts.int.test.ts
  ● volver a registrar el original libera la marca «No lleva comprobante» de una de sus ventas
    expect(received).toMatchObject(expected)
  ● volver a registrar un original con su nota de crédito vigente se rechaza en la API
    expected 409 "Conflict", got 201 "Created"
  ● los adjuntos solo se vuelven a asociar desde el mismo papel anulado
    expected 400 "Bad Request", got 201 "Created"
  ● HU-26 E4: marcar dos ventas y comprobar una libera solo su marca; la lista coincide con las uniones vivas
Tests:       4 failed, 12 passed, 16 total
```

Anular el cobro de un accesorio con un pago confirmado (S/ 20.00 de S/ 35.00),
con `voidCharge` devuelto al `sale.update` + `debtBalance decrement total` de
antes:

```text
pnpm test:integration -- test/integration/accessories.int.test.ts
  ● … › un cobro cuya venta tiene comprobante vigente no se anula hasta anular el comprobante
  ● … › anular un cobro con un pago confirmado anula el pago y devuelve solo lo que quedaba debiendo
    Expected: "0.00"
    Received: "-20.00"
  ● … › stop delivery sells accessory: … (arrastra la deuda mal devuelta)
    Expected: "35.00"
    Received: "15.00"
Test Suites: 2 failed, 2 total
Tests:       7 failed, 28 passed, 35 total
```

Verde con producción restaurada: `Test Suites: 2 passed, 2 total` /
`Tests: 35 passed, 35 total`.

Detalle (`canRegisterAgain`, `registeredAgainId`), unit antes de implementar:

```text
pnpm test -- src/modules/receipts/receipts.service.test.ts
  ● ReceiptsService reads › returns receipt detail with its sales, files, and audit users
  ● … › a voided receipt already loaded again points to the live one
  ● … › a voided receipt whose paper has a live credit note cannot be loaded again
  ● … › a voided credit note asks about the paper it affected
Tests:       4 failed, 25 passed, 29 total
```

Verde 52/52; integración de comprobantes 16/16 con las mismas aserciones por
API.

Web, con los cambios de `receipts/[id].vue` y `receipts/new.vue` apartados:

```text
vitest run test/nuxt/receipts.test.ts test/nuxt/receipt-registration.test.ts
     × la nota anulada cuyo original ya se volvió a registrar enlaza al vigente en vez de ofrecerlo otra vez
       × avisa y no deja calcular si una venta del original ya tiene otro comprobante
       × incluye la venta del original marcada «No lleva comprobante», que se libera al registrar
       × vuelve a asociar los adjuntos solo mientras sea el mismo papel, aunque cambie el medio
      Tests  4 failed | 19 passed (23)
```

Verde: 23/23.

Carrera encontrada por `reviewer`: un alta del mismo papel con otras ventas,
mientras una nota de crédito contra el original está en curso, leía el
original como vigente y quedaban vigentes la nota y el papel que anuló. El
test sostiene abierta una transacción que ya anuló el original y escribió la
nota. Rojo, sin el lock:

```text
pnpm test:integration -- test/integration/receipts.int.test.ts
  ● un alta del mismo papel con otras ventas espera a la nota de crédito en curso y se rechaza
    Expected: 409
    Received: 201
```

Verde, con `SELECT … FROM receipts WHERE type, series, number … FOR UPDATE`
antes del chequeo: integración de comprobantes 19/19 (incluye además el caso
«otro cliente» de los adjuntos contra Postgres).

El pago confirmado del test de accesorios se escribe directo en la base (con
su baja de deuda en la misma transacción): `POST /payments` no liga un cobro a
una venta (`saleId` queda en null), así que no hay otra vía para armar un
cobro de accesorio pagado. El cambio de producción de la decisión 4 es de
`c0cae53`; el rojo de arriba se obtuvo devolviendo a mano `voidCharge` al
código de antes de ese commit.

Tests nuevos sin cambio de producción (sin rojo posible, cubren lo que ya
existía): HU-26 E1 con una factura exitosa a un cliente con RUC, y HU-26 E3
por la vía de la nota de crédito (`released_by` = el vendedor que la
registró, `released_at`, y el original visible como anulado en el detalle y en
el filtro «Anulados»). Integración de comprobantes 18/18.

## Evidencia TDD acumulada

### Auditoría de adjuntos posteriores

Rojo, antes de agregar la migración y la escritura de auditoría:

```text
pnpm --filter @yacco/api test:integration -- receipts.int.test.ts
FAIL test/integration/receipts.int.test.ts
Raw query failed. Code: 42703. Message: column "created_at" does not exist
Tests: 1 failed, 1 passed, 2 total
```

Verde, con `20261014082300_receipt_file_audit` aplicada en la base efímera:

```text
pnpm --filter @yacco/api test:integration -- receipts.int.test.ts
PASS test/integration/receipts.int.test.ts
Tests: 2 passed, 2 total
```

El caso registra el comprobante con ADMIN y adjunta después con SELLER; verifica
que `receipt_files.created_by` sea el vendedor y que `created_at` sea posterior
al alta del comprobante.

### Alta de comprobante contra anulación concurrente

Rojo, con el alta esperando primero el lock de la venta y la anulación leyendo
el estado anterior:

```text
pnpm --filter @yacco/api test:integration -- receipts.int.test.ts
FAIL el alta de un comprobante gana el lock y evita que una anulación concurrente deje ambos vigentes
Received promise resolved instead of rejected
Resolved to value: debtDelta -35.00 (la venta quedó anulada)
Tests: 1 failed, 2 passed, 3 total
```

Verde, releyendo la venta después de tomar `FOR UPDATE`:

```text
pnpm --filter @yacco/api test:integration -- receipts.int.test.ts
PASS test/integration/receipts.int.test.ts
Tests: 3 passed, 3 total
```

### Serie y número únicos solo entre los vigentes (decisión 19:43)

Rojo, con el índice único `receipts_type_series_number_key` sobre todas las
filas:

```text
jest --config jest.integration.config.js receipts.int.test.ts -t "únicos solo entre los vigentes"
FAIL test/integration/receipts.int.test.ts
  ● tipo, serie y número son únicos solo entre los vigentes: anular y volver a registrar el mismo papel pasa
    expected 201 "Created", got 409 "Conflict"
    > 364 |     .expect(201);
Tests: 1 failed, 3 skipped, 4 total
```

Verde, con `20261014200000_receipts_active_series_number` (índice parcial
`WHERE voided_at IS NULL`):

```text
jest --config jest.integration.config.js receipts.int.test.ts receipts-schema.int.test.ts
Test Suites: 2 passed, 2 total
Tests: 8 passed, 8 total
```

El mismo caso comprueba que dos vigentes con el mismo tipo, serie y número se
rechazan con 409 aunque uno sea manual y el otro electrónico.

### Anular una nota de crédito y volver a registrar el original (corrección 20:00)

Rojo, antes de rechazar la nota electrónica y de aceptar `filesFromReceiptId`:

```text
pnpm test:integration -- receipts.int.test.ts
FAIL test/integration/receipts.int.test.ts (31.307 s)
  ● una nota de crédito electrónica no se anula
    expected 409 "Conflict", got 200 "OK"
    > 458 |     .expect(409);
  ● volver a registrar el original crea uno nuevo con el mismo número, las mismas ventas y sus adjuntos
    expected 201 "Created", got 400 "Bad Request"
    > 502 |     .expect(201);
  ● volver a registrar el original se rechaza si una de sus ventas ya está en otro comprobante
    expected 409 "Conflict", got 400 "Bad Request"
    > 566 |     .expect(409);
Tests:       3 failed, 5 passed, 8 total
```

Verde:

```text
pnpm test:integration -- receipts.int.test.ts
Tests:       8 passed, 8 total
```

«Anular una nota manual solo la marca» pasó en verde desde el principio: el
`void` ya no tocaba el original. El test compara las filas de `receipts` y
`receipt_sales` del original antes y después, y confirma que el vendedor
recibe 403. Los adjuntos se reasocian con el mismo `object_key` y una fila
nueva en `receipt_files` con quién y cuándo; la lectura del archivo busca por
nombre dentro del comprobante porque la clave lleva el id del original. Sin
esquema nuevo.

### El original lista sus notas de crédito (para ofrecer «Volver a registrar»)

Rojo, con el detalle sin `creditNotes`:

```text
pnpm test:integration -- receipts.int.test.ts -t "volver a registrar el original crea"
  ● volver a registrar el original crea uno nuevo con el mismo número, las mismas ventas y sus adjuntos
    - Expected  - 9
    + Received  + 0
    -   "creditNotes": Array [
```

Verde: `receipts.int.test.ts` 8/8; unit de receipts 43/43.

### Web: «Volver a registrar el original» y «Anular» solo en notas manuales

Rojo, antes de tocar `receipts/[id].vue` y `receipts/new.vue`:

```text
vitest run test/nuxt/receipts.test.ts test/nuxt/receipt-registration.test.ts
     × una nota de crédito electrónica vigente no ofrece anular
     × la nota de crédito anulada ofrece volver a registrar el original y enlaza a él
     × el original anulado lista sus notas y solo ofrece volver a registrarlo sin nota vigente
     × el original anulado por una nota de crédito vigente no ofrece volver a registrarlo
       × precarga los datos y las ventas del original y vuelve a asociar sus adjuntos
       × avisa y no deja calcular si una venta del original ya no está libre
 Test Files  2 failed (2)
      Tests  6 failed | 13 passed (19)
```

Verde:

```text
vitest run test/nuxt/receipts.test.ts test/nuxt/receipt-registration.test.ts test/nuxt/customer-receipts.test.ts
 Test Files  3 passed (3)
      Tests  23 passed (23)
```

### Anular un cobro de accesorio respeta el comprobante vigente (B.8)

`AccessoriesService.voidCharge` anulaba la venta con un `sale.update` directo,
sin lock ni mirar `receipt_sales`. Ahora pasa por
`SalesService.voidSaleWithinTransaction`: lock, rechazo con comprobante
vigente, anulación de sus cobros y devolución de deuda por el efecto real
(antes restaba el total aunque el cobro estuviera pagado).

Rojo:

```text
pnpm test:integration -- accessories.int.test.ts
  ● Accessories Module Integration Tests › Charging borrowed accessories and voiding charge › un cobro cuya venta tiene comprobante vigente no se anula hasta anular el comprobante
    expected 409 "Conflict", got 201 "Created"
Tests:       1 failed, 17 passed, 18 total
```

Verde:

```text
pnpm test:integration -- accessories.int.test.ts
Tests:       18 passed, 18 total
```

### HU-26 E1–E5, umbrales, marcas, liberación única y permisos

Tests de integración nuevos que citan los escenarios: E1 (tres ventas 1.00,
1.01 y 1.04: base por renglón 2.59, IGV 0.46, total 3.05), E2 (venta
comprobada y ventas de dos clientes), boleta bajo/sobre el umbral sin
documento y factura sin RUC, E3 (anular libera con `released_by` y
`released_at` reales, anular dos veces y nota sobre anulado se rechazan sin
tocar las uniones), E4 (dos ventas marcadas, comprobar una libera solo su
marca; la lista por estado y la reconstrucción SQL desde las uniones sin
liberar coinciden con una venta de cada clase; liberar una marca dos veces se
rechaza) y E5 (el flujo de adjuntos ya existente).

Rojo: se revirtieron a la vez, en producción, siete reglas — redondeo por
renglón, rechazo de venta ya comprobada, liberación de ventas al anular,
liberación de marcas al registrar, umbral de documento, `@Roles(ADMIN)` de
`void` y el filtro de marcas en «disponibles»:

```text
pnpm test:integration -- receipts.int.test.ts
  ● cada endpoint de comprobantes rechaza chofer y los datos fiscales son solo ADMIN
    expected 403 "Forbidden", got 404 "Not Found"
  ● ADMIN versiona los datos de facturación y la oficina ejecuta el flujo auditable (HU-26 E5: adjunto con y sin sesión)
    Expected: ArrayContaining [... tres ventas ...]
    Received: [... dos ventas ...]
  ● tipo, serie y número son únicos solo entre los vigentes: anular y volver a registrar el mismo papel pasa
    expected 201 "Created", got 409 "Conflict"
  ● anular una nota de crédito manual solo la marca: el original y sus ventas no se tocan
    expected 403 "Forbidden", got 200 "OK"
  ● volver a registrar el original se rechaza si una de sus ventas ya está en otro comprobante
    Expected: "Una o más ventas ya tienen un comprobante vigente"
    Received: "Ya existe un comprobante con ese tipo, serie y número"
  ● HU-26 E1: tres ventas de montos distintos cuadran total, base e IGV y quedan comprobadas
    -   "taxAmount": "0.46",
    -   "taxableAmount": "2.59",
    +   "taxAmount": "0.47",
    +   "taxableAmount": "2.58",
  ● HU-26 E2: una venta comprobada no entra en otro comprobante; ventas de dos clientes se rechazan
    Expected: "Una o más ventas ya tienen un comprobante vigente"
    Received: "Ya existe un comprobante con ese tipo, serie y número"
  ● la factura exige RUC y la boleta exige documento desde el monto configurado
    expected 400 "Bad Request", got 201 "Created"
  ● HU-26 E3: anular libera todas las ventas una sola vez, con quién y cuándo
    Expected: "<id del administrador>"
    Received: null
  ● HU-26 E4: marcar dos ventas y comprobar una libera solo su marca; la lista coincide con las uniones vivas
    -   "releaseReason": "Se registró el comprobante B001-000909",
    -   "releasedById": "<id del vendedor>",
    +   "releaseReason": null,
    +   "releasedById": null,
Tests:       10 failed, 3 passed, 13 total
```

Como E4 cortaba antes de la lista, el filtro de «disponibles» se revirtió solo:

```text
pnpm test:integration -- receipts.int.test.ts -t "HU-26 E4"
  ● HU-26 E4: marcar dos ventas y comprobar una libera solo su marca; la lista coincide con las uniones vivas
    - Expected  - 0
    + Received  + 1
    +   "a4642724-d0b3-49ef-85d5-282bb317ffe9",
```

Verde, con producción restaurada desde git:

```text
pnpm test:integration -- receipts.int.test.ts
Tests:       13 passed, 13 total
```

`receipts-schema.int.test.ts` sigue liberando con un UPDATE crudo: prueba
las restricciones de la base (CHECK e índices parciales), no la anulación.
La evidencia de anular y de la nota de crédito es la de arriba, por API.

### Menores de la revisión

- La API guarda la serie en mayúsculas (alta y nota de crédito). Rojo:
  `- "series": "FC01"` / `+ "series": "fc01"` y el alta con `" b001 "`
  (2 failed, 19 passed); verde 21/21.
- No se adjuntan archivos a un comprobante anulado (409). Rojo: «rejects a
  file for a voided receipt before storing anything» (1 failed, 43 passed);
  verde 44/44. Integración de comprobantes 17/17 después del cambio.
- `findSettings` se reusa en la vista previa; el lock y la anulación con
  liberación de ventas son un solo método para `void` y para la nota de
  crédito.
- «Registrar comprobante» trae todas las páginas de ventas libres. Rojo:
  «trae todas las páginas de ventas sin comprobante, no solo las primeras
  cien» (1 failed, 8 passed); verde 9/9.

### Textos de la oficina en la anulación de notas y en los adjuntos reusados

Rojo: «una nota de crédito manual vigente ofrece anular al ADMIN sin prometer
liberar ventas» y «precarga los datos … y vuelve a asociar sus adjuntos» (la
casilla mostraba el nombre interno del archivo) — 2 failed, 18 passed. Verde:
24/24 en los tres archivos de comprobantes.

### Textos compuestos sólo por espacios

Rojo: los siete casos de razón social, dirección, serie, número y motivos no
producían ningún error de `class-validator`. Verde: 49/49 tests enfocados de
DTOs y `SalesService`.

### Reintento de adjuntos y aviso de serie

Rojo del reintento parcial: después de fallar el XML, la UI hizo cuatro
peticiones (`PDF`, `XML`, `PDF`, `XML`) cuando debía hacer tres. Verde: conserva
sólo el archivo pendiente (`PDF`, `XML`, `XML`).

Rojo del aviso: después de confirmar una serie inusual y cambiarla, el botón
seguía diciendo «Registrar de todas formas». Verde: cambiar la serie exige una
confirmación nueva. El archivo enfocado quedó 6/6 y el typecheck de Nuxt pasó.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
