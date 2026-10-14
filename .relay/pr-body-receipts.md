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
