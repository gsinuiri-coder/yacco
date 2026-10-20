# Guarda `test/unit/nuxt-ui-routes.test.ts` — rojo y verde

PR (1) de rutas: páginas de rutas (lista, nueva, detalle) y los componentes
`RouteMarkOutcome`, `RouteStopAddForm`, `RouteBatchStopsForm`,
`RouteVehiclesSection` y `RouteLoadsSection`.

## Rojo — los 8 archivos vueltos a `main` (`git checkout main -- …`)

```
     × ../../app/pages/routes/index.vue no maqueta con elementos HTML sustituidos por Nuxt UI ni clases sin razón
     × ../../app/pages/routes/new.vue no maqueta con elementos HTML sustituidos por Nuxt UI ni clases sin razón
     × ../../app/pages/routes/[id]/index.vue no maqueta con elementos HTML sustituidos por Nuxt UI ni clases sin razón
     × ../../app/components/RouteMarkOutcome.vue no maqueta con elementos HTML sustituidos por Nuxt UI ni clases sin razón
     × ../../app/components/RouteStopAddForm.vue no maqueta con elementos HTML sustituidos por Nuxt UI ni clases sin razón
     × ../../app/components/RouteBatchStopsForm.vue no maqueta con elementos HTML sustituidos por Nuxt UI ni clases sin razón
     × ../../app/components/RouteVehiclesSection.vue no maqueta con elementos HTML sustituidos por Nuxt UI ni clases sin razón
     × ../../app/components/RouteLoadsSection.vue no maqueta con elementos HTML sustituidos por Nuxt UI ni clases sin razón
 FAIL  routes/index.vue        AssertionError: expected '<template>\n  <AppPage title="Rutas" …' not to match /:ui=/
 FAIL  routes/new.vue          AssertionError: expected '<template>\n  <AppPage\n    title="Pl…' not to match /<form\b/
 FAIL  routes/[id]/index.vue   AssertionError: expected '<template>\n  <AppPage\n    :title="r…' not to match /<dl\b/
 FAIL  RouteMarkOutcome.vue    AssertionError: clase sin razón … expected { …(4) } to have property "space-y-2"
 FAIL  RouteStopAddForm.vue    AssertionError: expected '<template>\n  <form class="space-y-5"…' not to match /<form\b/
 FAIL  RouteBatchStopsForm.vue AssertionError: expected '<template>\n  <form\n    class="space…' not to match /<form\b/
 FAIL  RouteVehiclesSection.vue AssertionError: expected '<template>\n  <SectionCard\n    title…' not to match /<table\b/
 FAIL  RouteLoadsSection.vue   AssertionError: expected '<template>\n  <SectionCard title="Car…' not to match /<table\b/
      Tests  8 failed (8)
```

## Verde — con la migración (`git checkout HEAD -- …`)

```
 Test Files  1 passed (1)
      Tests  8 passed (8)
```

## Suite web completa con la migración

```
 Test Files  65 passed (65)
      Tests  700 passed (700)
```

Ningún test existente cambió sus afirmaciones.
