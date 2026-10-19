<script setup lang="ts">
/**
 * Un desplegable abierto no deja el resto de la página muerta.
 *
 * Reka UI (debajo de Nuxt UI) abre `USelect` como capa modal y, mientras está
 * abierto, escribe `pointer-events: none` en línea sobre el `body`. El clic
 * que el usuario hace sobre OTRO control para cerrar el desplegable solo lo
 * cerraba y se perdía: había que repetirlo (medido con Playwright, 10 de 10;
 * `e2e/first-click.test.ts`). Lo escriben dos cosas, y cada una tiene su prop
 * en el contenido del desplegable: la capa (`disableOutsidePointerEvents`) y
 * el bloqueo del scroll de la página (`bodyLock`). `UTheme` apaga las dos en
 * todos los `USelect`, incluidos los que se agreguen después. Con el bloqueo
 * apagado, la página se puede desplazar con el desplegable abierto.
 *
 * Los diálogos no cambian: su fondo oscuro es un elemento propio que cubre la
 * página y recibe ese clic, así que nada de atrás se activa igual.
 */
const THEME_PROPS = {
  select: { content: { disableOutsidePointerEvents: false, bodyLock: false } },
};
</script>

<template>
  <UApp>
    <UTheme :props="THEME_PROPS">
      <NuxtLayout>
        <NuxtPage />
      </NuxtLayout>
    </UTheme>
  </UApp>
</template>
