# Guarda de liquidación (PR 3 de rutas) — rojo y verde

`apps/web-nuxt/test/unit/nuxt-ui-routes.test.ts`, extendida con
`pages/routes/[id]/settlement.vue` y `SettlementCountSheet.vue`.

## Rojo: los dos archivos como están en main (git stash de los dos)

```
× ../../app/pages/routes/[id]/settlement.vue no maqueta con elementos HTML sustituidos por Nuxt UI ni clases sin razón
× ../../app/components/SettlementCountSheet.vue no maqueta con elementos HTML sustituidos por Nuxt UI ni clases sin razón
AssertionError: expected '<template>\n  <AppPage\n    :title="r…' not to match /<form\b/
AssertionError: expected '<template>\n  <div class="space-y-2">…' not to match /<table\b/
Tests  2 failed | 13 passed (15)
```

## Verde: con la migración

```
Test Files  2 passed (2)
     Tests  31 passed (31)
```

(guarda + route-settlement, sin cambiar ninguna afirmación). Suite web
completa: 65 archivos / 707 tests.
