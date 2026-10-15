# Relevo

status: in-progress
item: Fase 3 — 8. Comprobantes registrados (goal en .relay/goals/fase3-8-comprobantes-y-guias.md)
branch: feat/receipts
last-step: Corrección 20:00, parte API con TDD: `void` rechaza la nota de crédito electrónica (409 en español); `POST /receipts` acepta `filesFromReceiptId` (comprobante anulado, mismo cliente y medio) y copia sus `receipt_files` con el mismo `object_key` y quién/cuándo nuevos; la lectura del archivo busca por nombre dentro del comprobante. Integración receipts.int 8/8 (rojo→verde en `.relay/pr-body-receipts.md`), unit de receipts 43/43.
  Web también hecha con TDD: el detalle lista las notas de crédito del original (`creditNotes`, solo lectura); «Volver a registrar el original» aparece en la nota anulada y en el original anulado sin nota vigente, y abre `receipts/new?from=<id>` precargado con todas sus ventas (si alguna ya no está libre, avisa y no deja calcular) y la casilla para reasociar adjuntos; «Anular» no aparece en notas electrónicas. Typecheck verde; web 23/23 en los tres archivos de comprobantes.
  Bug de `accessories.service.ts:635` corregido con TDD: `voidCharge` anula la venta por `SalesService.voidSaleWithinTransaction` (409 con comprobante vigente); accessories.int 18/18.
  Tests faltantes de la revisión agregados (HU-26 E1–E5, umbrales, liberación única con quién/cuándo, marcas, reconstrucción SQL de «sin comprobante»); rojo con siete reglas revertidas en producción y verde 13/13, todo en `.relay/pr-body-receipts.md`. Spec §Comprobantes y tabla de endpoints actualizadas con las decisiones 1–3.
  Menores hechos con TDD: serie en mayúsculas en la API, sin adjuntos en anulados, `findSettings` y anulación+liberación deduplicados, todas las páginas de ventas libres en «Registrar comprobante».
  Tablas de comprobantes (`index.vue`, `[id].vue`, `new.vue`, `CustomerReceiptsSection.vue`) pasadas a `UTable`; los 24 tests de web de comprobantes siguen verdes sin tocarlos y el typecheck de Nuxt pasa.
  `schema.prisma` sin reformateo: contra main son 120 inserciones y ninguna línea cambiada (`prisma validate` OK; `diff -w` contra la versión anterior solo difiere en una línea en blanco final).
next-step: Completar el cuerpo del PR (resumen, nota de auditoría de `receipt_files`, atribución), gates completos (lint, typecheck, build, test, `pnpm test:integration` entero en primer plano), revisión con `reviewer`, abrir el PR, cinco checks verdes, squash y borrar la rama. Lo que queda de .relay/review-receipts.md: los menores, sacar el reformateo de `schema.prisma` del diff, completar el cuerpo del PR; después `pnpm test:integration` completo en primer plano, gates, reviewer y PR.
blocked-reason:
updated: 2026-10-14T21:05:00-05:00 por Claude (relevo)
