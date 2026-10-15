# Relevo

status: in-progress
item: Fase 3 — 9. Panel por rol y solo Nuxt UI (goal en .relay/goals/fase3-9-nuxt-ui-y-panel.md)
branch: refactor/nuxt-ui-routes
last-step: PR #327 (9b, secciones de la ficha del cliente) fusionado con squash en main (be69271), los cinco checks en verde, sin --admin, rama borrada. 9b hecho hasta ahora: layout y menú (#324), pedidos (#325), clientes (#326), secciones del cliente (#327). 9a: #323.
next-step: Área 9b «rutas y liquidación» en esta rama: inventariar las clases de las páginas y componentes de rutas, Mi ruta y liquidación (apps/web-nuxt/app/pages/routes/**, my-route, settlement y sus componentes); capturas «antes» con Playwright (escritorio 1280×900 y móvil 390×844, con datos: ruta planificada, en curso con paradas resueltas y una anulada/corregida, liquidación con diferencia) en docs/visual-reviews/9b-routes/; guarda de clases como test/unit/nuxt-ui-customer-sections.test.ts; migrar; rojo/verde; reviewer; PR. Ojo: UPageCard pinta #footer antes del slot por defecto, y UPageList necesita as="ul" si los ítems son li. SectionCard sigue pendiente (lo usan pantallas de varias áreas): migrarlo en el último PR de 9b o en uno propio. Quedan después: producción, inventario y planta; catálogos, usuarios y reportes.
updated: 2026-10-15T18:20:00-05:00 por Claude (relevo)
