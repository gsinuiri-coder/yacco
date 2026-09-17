<script setup lang="ts">
/** Una sección con título dentro de una pantalla: la ficha del cliente, el detalle de una ruta. */
defineProps<{ title: string; description?: string }>();
</script>

<template>
  <section class="rounded-lg border border-default bg-default">
    <header
      class="flex flex-wrap items-center justify-between gap-3 border-b border-default px-5 py-4"
    >
      <div>
        <h2 class="text-lg font-semibold text-highlighted">{{ title }}</h2>
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
