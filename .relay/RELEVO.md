# Relevo

status: in-progress
item: Fase 3 — 8. Comprobantes registrados (goal en .relay/goals/fase3-8-comprobantes-y-guias.md)
branch: feat/receipts
last-step: Decisión 1 hecha con TDD (7a01b86): migración `20261014200000_receipts_active_series_number` reemplaza `receipts_type_series_number_key` por un índice único parcial `WHERE voided_at IS NULL`; test de integración rojo→verde, salidas en `.relay/pr-body-receipts.md`. Decisión 2 no necesitó cambio de producción: `POST /receipts/:id/credit-notes` ya admite SELLER y el test de integración «la oficina ejecuta el flujo auditable» registra la nota de crédito con el token del vendedor (201). Decisión 3 no empezada: ver blocked-reason.
next-step: Giancarlo corrigió la decisión 3 (2026-10-14 20:00): anular una nota de crédito manual solo la marca; el original sigue anulado y se restaura registrándolo de nuevo con «Volver a registrar el original». Leé la última sección de .relay/goals/fase3-8-comprobantes-y-guias.md, implementala con TDD, y después lo pendiente de .relay/review-receipts.md, integración en primer plano, gates y PR.
blocked-reason:
updated: 2026-10-14T20:02:00-05:00 por Claude (conversación con Giancarlo)
