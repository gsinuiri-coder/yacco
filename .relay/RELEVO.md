# Relevo

status: in-progress
item: Fase 3 — 8. Comprobantes registrados (goal en .relay/goals/fase3-8-comprobantes-y-guias.md)
branch: feat/receipts
last-step: Corrección 20:00, parte API con TDD: `void` rechaza la nota de crédito electrónica (409 en español); `POST /receipts` acepta `filesFromReceiptId` (comprobante anulado, mismo cliente y medio) y copia sus `receipt_files` con el mismo `object_key` y quién/cuándo nuevos; la lectura del archivo busca por nombre dentro del comprobante. Integración receipts.int 8/8 (rojo→verde en `.relay/pr-body-receipts.md`), unit de receipts 43/43.
next-step: Web de la corrección 20:00: botón «Volver a registrar el original» en el detalle de la nota de crédito anulada y en el del original, que abre `receipts/new` precargado (tipo, medio, serie, número, fecha, cliente, ventas) y manda `filesFromReceiptId`; «Anular» solo para notas manuales. Test de web por texto visible. Después lo pendiente de .relay/review-receipts.md, integración completa en primer plano, gates y PR.
blocked-reason:
updated: 2026-10-14T20:40:00-05:00 por Claude (relevo)
