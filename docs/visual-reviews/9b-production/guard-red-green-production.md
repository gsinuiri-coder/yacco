# Guarda de producción (PR 1 de producción e inventario) — rojo y verde

`apps/web-nuxt/test/unit/nuxt-ui-production.test.ts`, sobre `pages/production.vue`
y `components/ProductionMaquilaSection.vue`. La comprobación vive en
`test/support/nuxt-ui-guard.ts` para que las próximas guardas del área
(inventario, maquila, envases) no la copien.

## Rojo: los dos archivos como están en main

Sin `git stash` en el relevo: se escribieron las versiones de `origin/main`
sobre los dos archivos (`git diff --stat origin/main` vacío) y se restauraron
desde el índice después.

```
× ../../app/pages/production.vue no maqueta con elementos HTML sustituidos por Nuxt UI ni clases sin razón
× ../../app/components/ProductionMaquilaSection.vue no maqueta con elementos HTML sustituidos por Nuxt UI ni clases sin razón
AssertionError: expected '<template>\n  <AppPage title="Producc…' not to match /<table\b/
 ❯ expectNativeNuxtUi test/support/nuxt-ui-guard.ts:18:24
Test Files  1 failed (1)
     Tests  2 failed (2)
```

## Verde: con la migración

```
Test Files  3 passed (3)
     Tests  22 passed (22)
```

(guarda + production + production-maquila, sin cambiar ninguna afirmación). Suite web
completa: 66 archivos / 709 tests. `nuxt typecheck` limpio.

Sin capturas antes/después en este PR: el relevo no levanta la app.
