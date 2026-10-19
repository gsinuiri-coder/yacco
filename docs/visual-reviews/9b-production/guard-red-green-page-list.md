# Guarda: UPageList sólo como lista real — rojo y verde

`UPageList` de @nuxt/ui 4.11.3 pone siempre `role="list"` (PageList.vue:24).
Usado como contenedor de avisos, tarjetas o formularios, el lector de pantalla
anuncia una lista sin elementos. La guarda `expectNativeNuxtUi`
(`apps/web-nuxt/test/support/nuxt-ui-guard.ts`) ahora exige que todo
`<UPageList>` declare `as="ul"` o `as="ol"`; para apilar se usa `UPageBody`
(sin rol, mismo `space-y-6` por `app.config.ts`).

## Rojo — guarda nueva, plantillas de main

`pnpm exec vitest run test/unit/nuxt-ui-production.test.ts`:

```
 FAIL  ../../app/pages/production.vue …
 FAIL  ../../app/components/ProductionMaquilaSection.vue …
 FAIL  ../../app/pages/inventory.vue …
AssertionError: UPageList que no es lista en …/inventory.vue: expected '<UPageList v-else>' to match /\sas="(ul|ol)"/
 FAIL  ../../app/components/PlantCountForm.vue …
AssertionError: UPageList que no es lista en …/PlantCountForm.vue: expected '<UPageList v-if="reviewing !== null" …' to match /\sas="(ul|ol)"/

 Test Files  1 failed (1)
      Tests  4 failed | 1 passed (5)
```

## Verde — plantillas migradas

- `production.vue`: los dos contenedores (registrar llenada, renglones de
  tipo de envase) pasan a `UPageBody`; el registro de llenadas de un lote es
  una lista de verdad: `UPageList as="ul"` con cada `UPageCard as="li"`.
- `ProductionMaquilaSection.vue`, `inventory.vue`: contenedor → `UPageBody`.
- `PlantCountForm.vue`: `UPageBody role="group"` con su `aria-label`. Antes
  el `role="group"` pisaba al de lista por herencia de atributos; ahora el
  grupo no depende de ese orden.

```
 Test Files  66 passed (66)
      Tests  712 passed (712)
```
