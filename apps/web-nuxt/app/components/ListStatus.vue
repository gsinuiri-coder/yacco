<script setup lang="ts">
/**
 * Lo que ocupa el lugar de una lista cuando no hay filas que mostrar: el
 * error con reintento, la carga, o el vacío. El vacío distingue "no hay
 * ninguno" de "ninguno coincide", porque la acción que corresponde es otra.
 */
defineProps<{
  errorMessage: string | null;
  loading: boolean;
  empty: boolean;
  loadingLabel: string;
  errorTitle?: string;
  emptyTitle: string;
  emptyDescription: string;
  emptyIcon?: string;
}>();
defineEmits<{ retry: [] }>();
</script>

<template>
  <div v-if="errorMessage" class="flex flex-col items-center gap-3 px-6 py-14 text-center">
    <UIcon name="i-lucide-cloud-off" class="size-8 text-error" aria-hidden="true" />
    <p class="font-medium text-highlighted">{{ errorTitle ?? "No se pudo cargar la lista" }}</p>
    <p role="alert" class="max-w-md text-muted">{{ errorMessage }}</p>
    <UButton
      color="neutral"
      variant="outline"
      icon="i-lucide-rotate-cw"
      label="Reintentar"
      @click="$emit('retry')"
    />
  </div>
  <div v-else-if="loading" class="flex items-center justify-center gap-2 px-6 py-14 text-muted">
    <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin" aria-hidden="true" />
    <p role="status">{{ loadingLabel }}</p>
  </div>
  <div v-else-if="empty" class="flex flex-col items-center gap-3 px-6 py-14 text-center">
    <UIcon :name="emptyIcon ?? 'i-lucide-inbox'" class="size-8 text-dimmed" aria-hidden="true" />
    <p class="font-medium text-highlighted">{{ emptyTitle }}</p>
    <p class="max-w-md text-muted">{{ emptyDescription }}</p>
    <slot name="empty-actions" />
  </div>
</template>
