# Relevo

status: in-progress
item: Fase 3 — 8. Comprobantes registrados (goal en .relay/goals/fase3-8-comprobantes-y-guias.md)
branch: feat/receipts
last-step: Corrección 20:00 hecha con TDD, API y web. Anular una nota de crédito solo se permite si es manual (las electrónicas dan 409) y solo marca la nota. `POST /receipts` acepta `filesFromReceiptId`, que vuelve a asociar los adjuntos de un comprobante anulado del mismo cliente y medio. El detalle muestra `creditNotes`. «Volver a registrar el original» abre `receipts/new?from=<id>` con todo precargado. También: bug de accesorios (B.8) corregido; tests HU-26 E1–E5 con su rojo; menores de la revisión anterior; tablas pasadas a `UTable`; `schema.prisma` sin reformateo; spec actualizada; cuerpo del PR completo salvo el resultado de la integración entera. Gates verdes: lint, typecheck, build, `pnpm test` (API 1436, web 637, shared 44, firestore-export 54). `pnpm test:integration` entero: 44 suites, 780 tests, todo verde. La revisión con `reviewer` encontró los puntos de abajo; ya están corregidos dos textos de la web (anular una nota; casilla de adjuntos con nombres internos). El PR todavía no está abierto.
next-step: Giancarlo decidió las cuatro dudas (2026-10-14 21:25). Leé la última sección de .relay/goals/fase3-8-comprobantes-y-guias.md, implementalas con TDD, después los menores técnicos que anotaste, gates con integración en primer plano, y el PR.
blocked-reason:
updated: 2026-10-14T21:26:00-05:00 por Claude (conversación con Giancarlo)
