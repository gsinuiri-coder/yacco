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
  <section class="rounded-lg border border-default bg-default" :aria-labelledby="titleId">
    <header
      class="flex flex-wrap items-center justify-between gap-3 border-b border-default px-5 py-4"
    >
      <div>
        <h2 :id="titleId" class="text-lg font-semibold text-highlighted">{{ title }}</h2>
        <p v-if="description" class="text-sm text-muted">{{ description }}</p>
      </div>
      <div class="flex items-center gap-2">
        <slot name="actions" />
      </div>
    </header>
    <div class="px-5 py-4">
      <slot />
    </div>
  </section>
</template>
