# Relevo

status: in-progress
item: Fase 3 — 8. Comprobantes registrados (goal en .relay/goals/fase3-8-comprobantes-y-guias.md)
branch: feat/receipts
last-step: Paso 5d completado con TDD: la anulación de venta ahora toma `FOR UPDATE` y relee el comprobante vigente (la carrera pasó de dejar venta anulada + comprobante vigente a 3/3 integración); los DTO rechazan razón social, dirección, serie, número y motivos hechos sólo de espacios (49/49 unitarios enfocados); el alta web conserva sólo adjuntos pendientes al reintentar y vuelve a pedir confirmación si cambia una serie inusual (6/6 web). Typecheck de API y Nuxt verdes. Evidencias agregadas a `.relay/pr-body-receipts.md`.
next-step: Ejecutar los gates completos (`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm build`, `pnpm prisma:validate`), corregir sólo fallas del ítem con TDD y luego hacer la revisión final y visual antes de abrir el PR.
blocked-reason:
updated: 2026-10-14T08:52:17-05:00 por Codex
