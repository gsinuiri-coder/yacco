<script setup lang="ts">
/**
 * Una sección con título dentro de una pantalla: la ficha del cliente, el
 * detalle de una ruta. El título le da nombre a la región (`aria-labelledby`),
 * así un lector de pantalla —y un test— la encuentra por su título.
 */
defineProps<{ title: string; description?: string }>();
const titleId = useId();
</script>

<template>
  <UPageCard as="section" :aria-labelledby="titleId" :description="description" variant="outline">
    <template #title>
      <h2 :id="titleId">{{ title }}</h2>
    </template>
    <template #footer>
      <UFieldGroup>
        <slot name="actions" />
      </UFieldGroup>
    </template>
    <slot />
  </UPageCard>
</template>
