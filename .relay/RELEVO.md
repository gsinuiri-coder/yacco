# Relevo

status: blocked
item: Fase 3 — 8. Comprobantes registrados (goal en .relay/goals/fase3-8-comprobantes-y-guias.md)
branch: feat/receipts
last-step: Paso 6, gates y revisión final. En verde: `pnpm lint`, `pnpm typecheck`, `pnpm prisma:validate`, `pnpm build` y `pnpm test` (API 1428, web 629, shared 44, firestore-export 54). `pnpm test:integration` se cortó por el límite de 10 minutos en segundo plano y no dejó resultado; al retomar, correrlo con un timeout más largo. La revisión del diff contra main está en `.relay/review-receipts.md`: 3 dudas de dominio, 1 bug que viola B.8 (anular un cobro de accesorio saltea el guard de comprobante), tests que faltan y un cuerpo de PR incompleto.
next-step: Cuando Giancarlo responda las 3 dudas de `.relay/review-receipts.md`, implementar lo que decida. Después, con TDD: arreglar `accessories.service.ts:635` para que pase por el guard de anulación de ventas, completar los tests y las salidas en rojo listadas, sacar el reformateo de `schema.prisma` del diff, completar `.relay/pr-body-receipts.md`, volver a correr todos los gates (incluida integración) y hacer la revisión visual antes de abrir el PR.
blocked-reason: Hay dudas de dominio que el goal no cubre (goal, línea 100). (1) B.9 pide anular y registrar de nuevo, pero el único sobre tipo+serie+número también cuenta los anulados, así que no se puede volver a cargar el mismo papel. ¿El único va sólo sobre los vigentes? Eso sería un índice nuevo, fuera del esquema autorizado. (2) ¿La nota de crédito, que anula el original, puede registrarla el vendedor, o cae en «anular, solo el administrador»? (3) ¿Se puede anular una nota de crédito? Y si sí, ¿qué pasa con el comprobante original? No elegí la opción más fácil de programar.
updated: 2026-10-14T10:05:00-05:00 por Claude
