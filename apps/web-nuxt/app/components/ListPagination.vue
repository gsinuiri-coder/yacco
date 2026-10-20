<script setup lang="ts">
defineProps<{
  /** La página de la respuesta: puede ir atrás de `page` mientras la siguiente viaja. */
  shownPage: number;
  page: number;
  totalPages: number;
}>();
defineEmits<{ previous: []; next: [] }>();
</script>

<template>
  <nav
    aria-label="Paginación"
    class="flex items-center justify-between gap-4 border-t border-default px-4 py-3"
  >
    <span class="text-sm text-muted">Página {{ shownPage }} de {{ totalPages }}</span>
    <UFieldGroup>
      <UButton
        color="neutral"
        variant="outline"
        icon="i-lucide-chevron-left"
        label="Anterior"
        :disabled="page <= 1"
        @click="$emit('previous')"
      />
      <UButton
        color="neutral"
        variant="outline"
        trailing-icon="i-lucide-chevron-right"
        label="Siguiente"
        :disabled="page >= totalPages"
        @click="$emit('next')"
      />
    </UFieldGroup>
  </nav>
</template>
