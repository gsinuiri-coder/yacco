# Relevo

status: in-progress
item: Fase 3 — 8. Comprobantes registrados (goal en .relay/goals/fase3-8-comprobantes-y-guias.md)
branch: feat/receipts
last-step: Paso 5c completado: `receipt_files` suma `created_at` y `created_by` mediante la migración aditiva nueva `20261014082300_receipt_file_audit`; el servicio registra siempre el usuario y el instante del adjunto. El test distinguió comprobante ADMIN de adjunto SELLER y pasó de rojo (columnas ausentes) a verde (2/2 integración, 9/9 unitarios enfocados); Prisma validate y typecheck API también quedaron verdes. La autorización fija de columnas de auditoría quedó en la cabecera de Fase 3 del plan.
next-step: Corregir con TDD los hallazgos finales de concurrencia, validación y UX de comprobantes; reconstruirlos con una revisión integral del diff contra main, porque el relevo anterior no dejó el detalle enumerado. Después repetir gates, revisión independiente y abrir el PR.
blocked-reason:
updated: 2026-10-14T08:33:49-05:00 por Codex
