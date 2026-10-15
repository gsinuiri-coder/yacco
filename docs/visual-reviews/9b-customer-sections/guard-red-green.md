# Guarda de clases — rojo y verde

Guarda: `apps/web-nuxt/test/unit/nuxt-ui-customer-sections.test.ts`.

## Rojo

Con `class="text-sm text-muted"` agregado a mano en
`CustomerContainersSection.vue` («Contado el …»), una clase que no está en la
lista permitida:

```
× ../../app/components/CustomerContainersSection.vue no maqueta con elementos HTML sustituidos por Nuxt UI ni clases sin razón 13ms
AssertionError: clase sin razón en ../../app/components/CustomerContainersSection.vue: expected { …(9) } to have property "text-sm text-muted"
 Test Files  1 failed (1)
      Tests  1 failed | 8 passed (9)
```

## Verde

Sin esa clase, suite completa de `apps/web-nuxt`:

```
 Test Files  64 passed (64)
      Tests  688 passed (688)
All files          |   90.14 |     83.7 |   89.89 |   91.54 |
```
