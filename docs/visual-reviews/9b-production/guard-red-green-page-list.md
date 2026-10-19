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

## Las llenadas como elementos de lista

La guarda mira sólo la etiqueta de `UPageList`, no sus hijos. Para el
`as="li"` de cada llenada, `test/nuxt/production.test.ts` pide tres
`listitem` dentro de «Llenadas del lote …». Sin `as="li"`:

```
 FAIL  |nuxt| test/nuxt/production.test.ts > Producción > lista código, fecha, responsable, lo producido y lo que queda sin cargar (o «Todo cargado»)
TestingLibraryElementError: Unable to find an accessible element with the role "listitem"
      Tests  1 failed | 16 passed (17)
```

Con `as="li"`: `Tests  22 passed (22)` (ese archivo más la guarda).

## Fuera de este PR

El mismo uso de `UPageList` como contenedor sigue en rutas, liquidación,
pedidos no entregados y «Mi ruta» (`RoutePitStopForm`, `RoutePitStopsSection`,
`RouteMarkOutcome`, `RouteLoadsSection`, `RouteVehiclesSection`,
`RouteStopsSection`, `routes/[id]/settlement.vue`, `orders/undelivered.vue`,
`my-route.vue`). Sus guardas no usan `expectNativeNuxtUi`; quedan para un PR
aparte.
