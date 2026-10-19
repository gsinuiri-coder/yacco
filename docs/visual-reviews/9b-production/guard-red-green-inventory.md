# Guarda de inventario (PR 2 de producción e inventario) — rojo y verde

`apps/web-nuxt/test/unit/nuxt-ui-production.test.ts`, ahora también sobre
`pages/inventory.vue`, `components/PlantCountForm.vue` y
`components/InventoryQuantity.vue`.

## Rojo: los tres archivos como están en main

Se sumaron los tres a `PRODUCTION_TEMPLATES` antes de tocarlos (los archivos
eran idénticos a `origin/main` en ese momento) y se corrió la guarda:

```
× ../../app/pages/inventory.vue no maqueta con elementos HTML sustituidos por Nuxt UI ni clases sin razón
× ../../app/components/PlantCountForm.vue no maqueta con elementos HTML sustituidos por Nuxt UI ni clases sin razón
× ../../app/components/InventoryQuantity.vue no maqueta con elementos HTML sustituidos por Nuxt UI ni clases sin razón
AssertionError: expected '<template>\n  <AppPage\n    title="In…' not to match /<table\b/
AssertionError: expected '<template>\n  <div\n    v-if="reviewi…' not to match /<form\b/
AssertionError: clase sin razón en …/InventoryQuantity.vue: expected { …(7) } to have property "inline-flex items-center gap-1 font-semibold text-error"
Tests  3 failed | 2 passed (5)
```

## Verde: con la migración

```
Test Files  2 passed (2)
     Tests  17 passed (17)
```

(guarda + inventory). Un cambio de afirmación en `test/nuxt/inventory.test.ts`:
`UTable` no genera encabezados de fila (`<th scope="row">`), así que el nombre
del tipo pasa a ser una celda y la fila se ubica por `role="cell"` en vez de
`role="rowheader"`. Las cantidades que se comparan son las mismas.

Clases nuevas en `ALLOWED_CLASSES`: `underline` (enlaces dentro del texto del
aviso) y `sr-only` («en negativo» como texto para el lector de pantalla).

Sin capturas antes/después en este PR: el relevo no levanta la app.
