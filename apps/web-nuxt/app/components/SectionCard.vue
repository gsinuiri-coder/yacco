<script setup lang="ts">
/**
 * Una sección con título dentro de una pantalla: la ficha del cliente, el
 * detalle de una ruta. El título le da nombre a la región (`aria-labelledby`),
 * así un lector de pantalla —y un test— la encuentra por su título.
 *
 * Las acciones van en el `#footer` de UPageCard, que se pinta entre el título
 * y el contenido: quedan en el mismo orden que antes, arriba del contenido.
 */
defineProps<{ title: string; description?: string }>();
const titleId = useId();
</script>

<template>
  <UPageCard as="section" :aria-labelledby="titleId" :description="description">
    <template #title>
      <h2 :id="titleId">{{ title }}</h2>
    </template>
    <template v-if="$slots.actions" #footer>
      <div class="flex flex-wrap items-center gap-2">
        <slot name="actions" />
      </div>
    </template>
    <slot />
  </UPageCard>
</template>
