# Relevo

status: in-progress
item: Fase 3 — 9. Panel por rol y solo Nuxt UI (goal en .relay/goals/fase3-9-nuxt-ui-y-panel.md)
branch: refactor/nuxt-ui-customer-sections
last-step: Capturas «after-*» rehechas con Playwright (script temporal, ya borrado; Playwright levantó y bajó API y Nuxt). Nuevas con datos: after-*-prices-with-rows, -prices-editing, -maquila-with-balances, -maquila-return-modal, -account-statement-voided. Las capturas mostraron «Devolver llenos» arriba de los saldos (#footer de UPageCard se pinta antes del contenido): movido al slot por defecto, con test de orden y rojo/verde en guard-red-green.md. vitest web 64/688 verde antes del test nuevo; maquila 7/7; lint y typecheck OK. Notas para el PR: en móvil la barra fija de arriba tapa el borde superior de las capturas de sección; el título largo del modal Devolver se corta junto a la X (UModal nativo, igual que en main); tablas anchas (estado de cuenta, movimientos) se desplazan en horizontal dentro de la tarjeta.
next-step: Pasar `reviewer` de nuevo sobre el diff contra main, corregir lo que encuentre; luego push y PR (cuerpo por --body-file: lista de clases de ALLOWED_CLASSES y de utils/table-columns.ts con su razón, los dos rojo/verde de guard-red-green.md, capturas antes/después con y sin datos, notas del last-step, nota de que SectionCard queda para el PR de layout).
updated: 2026-10-15T17:30:00-05:00 por Claude (relevo)
