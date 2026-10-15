# Relevo

status: in-progress
item: Fase 3 — 8. Comprobantes registrados (goal en .relay/goals/fase3-8-comprobantes-y-guias.md)
branch: feat/receipts
last-step: Paso 6, gates y revisión final. En verde: `pnpm lint`, `pnpm typecheck`, `pnpm prisma:validate`, `pnpm build` y `pnpm test` (API 1428, web 629, shared 44, firestore-export 54). `pnpm test:integration` se cortó por el límite de 10 minutos en segundo plano y no dejó resultado; al retomar, correrlo con un timeout más largo. La revisión del diff contra main está en `.relay/review-receipts.md`: 3 dudas de dominio, 1 bug que viola B.8 (anular un cobro de accesorio saltea el guard de comprobante), tests que faltan y un cuerpo de PR incompleto.
next-step: Giancarlo decidió las tres dudas (2026-10-14 19:43). Leé la última sección de .relay/goals/fase3-8-comprobantes-y-guias.md y seguí en feat/receipts: migración del índice parcial, notas de crédito del vendedor, anulación solo de notas de crédito manuales, y después lo pendiente de .relay/review-receipts.md, integración en primer plano, gates y PR.
blocked-reason:
updated: 2026-10-14T19:45:00-05:00 por Claude (conversación con Giancarlo)
