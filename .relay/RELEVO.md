# Relevo

status: in-progress
item: Fase 3 — 9. Panel por rol y solo Nuxt UI (goal en .relay/goals/fase3-9-nuxt-ui-y-panel.md)
branch: refactor/nuxt-ui-customer-sections
last-step: Revisión con `reviewer` hecha y corregida (commit fix(web): keep customer sections' visible text and semantics): SectionCard vuelve a main (lo usan ~16 pantallas fuera del área; va con el PR de layout), textos visibles restaurados, cabeceras «Acciones»/«Elegir» ocultas, montos a la derecha por meta de columna (utils/table-columns.ts), anuladas del estado de cuenta marcadas otra vez, li/h3, inputs a lo ancho. La guarda pasó a lista permitida con razón por clase (ALLOWED_CLASSES en el test). Rojo/verde en docs/visual-reviews/9b-customer-sections/guard-red-green.md. vitest 64/688 verde (líneas 91,54%), lint, typecheck y build OK.
next-step: Las capturas «after-*» de docs/visual-reviews/9b-customer-sections/ quedaron viejas: retomarlas con Playwright (demo:up + dev:api + dev:web-nuxt, puertos 3200/3201), incluyendo estados con datos (precios con filas y en edición, maquila con saldos y modal Devolver abierto, estado de cuenta con una anulada). Bajar los servidores. Pasar `reviewer` de nuevo sobre el diff, luego push y PR (cuerpo por --body-file: lista de clases de ALLOWED_CLASSES y de utils/table-columns.ts con su razón, rojo/verde de guard-red-green.md, capturas antes/después, nota de que SectionCard queda para el PR de layout).
updated: 2026-10-15T17:05:00-05:00 por Claude (relevo)
