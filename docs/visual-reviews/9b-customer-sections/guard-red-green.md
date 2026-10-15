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

# «Devolver llenos» después de los saldos — rojo y verde

Las capturas con datos mostraron el botón arriba de los saldos: `UPageCard`
pinta su `#footer` antes del slot por defecto. En main iba después de los
saldos y el precio. Test: `test/nuxt/customer-maquila.test.ts`, «muestra
«Devolver llenos» después de los saldos y el precio…».

## Rojo

Con el botón otra vez en `<template #footer>`:

```
× muestra «Devolver llenos» después de los saldos y el precio, como en la ficha original 161ms
AssertionError: expected +0 to be 4 // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 6 passed (7)
```

## Verde

Con el botón en el slot por defecto, después del precio:

```
 Test Files  1 passed (1)
      Tests  7 passed (7)
```
