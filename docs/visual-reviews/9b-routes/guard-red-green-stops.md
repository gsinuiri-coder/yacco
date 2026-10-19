# Guarda de paradas (PR 2 de rutas) — rojo y verde

`apps/web-nuxt/test/unit/nuxt-ui-routes.test.ts`, extendida con
RouteStopsSection, RouteStopMarkForm, RoutePitStopsSection, RoutePitStopForm y
`pages/my-route.vue`.

## Rojo: los cinco archivos como están en main (git stash de los cinco)

```
× ../../app/components/RouteStopsSection.vue no maqueta con elementos HTML sustituidos por Nuxt UI ni clases sin razón
× ../../app/components/RouteStopMarkForm.vue no maqueta con elementos HTML sustituidos por Nuxt UI ni clases sin razón
× ../../app/components/RoutePitStopsSection.vue no maqueta con elementos HTML sustituidos por Nuxt UI ni clases sin razón
× ../../app/components/RoutePitStopForm.vue no maqueta con elementos HTML sustituidos por Nuxt UI ni clases sin razón
× ../../app/pages/my-route.vue no maqueta con elementos HTML sustituidos por Nuxt UI ni clases sin razón
AssertionError: expected '<template>\n  <SectionCard title="Par…' not to match /<table\b/
AssertionError: expected '<template>\n  <form\n    class="space…' not to match /<table\b/
AssertionError: clase sin razón en ../../app/components/RoutePitStopsSection.vue: expected { …(8) } to have property "space-y-6"
AssertionError: expected '<template>\n  <div class="space-y-6">…' not to match /<form\b/
AssertionError: clase sin razón en ../../app/pages/my-route.vue: expected { …(8) } to have property "mx-auto w-full max-w-xl space-y-6"
Tests  5 failed | 8 passed (13)
```

## Verde: con la migración

```
Test Files  5 passed (5)
     Tests  88 passed (88)
```

(guarda + route-detail, route-stop-mark, route-pit-stops y my-route, sin
cambiar ninguna afirmación). Suite web completa: 65 archivos / 705 tests.
