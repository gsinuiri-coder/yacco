# Comprobantes registrados

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
