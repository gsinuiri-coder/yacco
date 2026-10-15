# Relevo

status: in-progress
item: Fase 3 — 8. Comprobantes registrados (goal en .relay/goals/fase3-8-comprobantes-y-guias.md)
branch: feat/receipts
last-step: Decisiones 21:25 hechas con TDD, rojo y verde (API unit + integración, web): registrar libera la marca también al volver a registrar; la API rechaza un papel con nota de crédito vigente; adjuntos solo del mismo cliente, tipo, serie y número; cobro de accesorio con pago confirmado (rojo «Expected "0.00" Received "-20.00"»). Menores hechos: el detalle trae `canRegisterAgain`/`registeredAgainId` y la web deja de ofrecer «Volver a registrar» si el papel ya está vigente; E1 con factura exitosa y E3 por nota de crédito en integración. `support/test-storage.ts` se queda (sacarlo duplica el arranque de MinIO; explicado en el PR). Revisión con `reviewer`: sin bloqueantes; corregida con TDD una carrera (alta del mismo papel durante una nota de crédito en curso: lock del papel antes del chequeo), y agregado el caso «otro cliente» de adjuntos. Gates verdes: lint, typecheck, build, `pnpm test` (API 1444, web 640, shared 44, firestore-export 54). Cuerpo del PR en `.relay/pr-body-receipts.md`, con el marcador INTEGRATION_RESULT pendiente. La integración entera corre ahora (la anterior se cortó a los 20 min por el límite de la herramienta, no por un fallo).
next-step: Con la integración entera verde, reemplazar INTEGRATION_RESULT en `.relay/pr-body-receipts.md` por sus líneas `Test Suites`/`Tests`, abrir el PR con `--body-file`, esperar los cinco checks y hacer squash-merge sin `--admin`; después seguir «Al mergear» del goal. Si algo falla, corregirlo antes.
blocked-reason:
updated: 2026-10-14T23:20:00-05:00 por Claude (relevo)
