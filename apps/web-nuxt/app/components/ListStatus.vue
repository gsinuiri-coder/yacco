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
const emit = defineEmits<{ retry: [] }>();
const errorActions = [retryAction(() => emit("retry"))];
</script>

<template>
  <UEmpty
    v-if="errorMessage"
    variant="naked"
    icon="i-lucide-cloud-off"
    :title="errorTitle ?? 'No se pudo cargar la lista'"
    :actions="errorActions"
  >
    <template #description>
      <p role="alert">{{ errorMessage }}</p>
    </template>
  </UEmpty>
  <!-- Sin la prop `loading`: pone aria-busy, y eso calla el role="status". -->
  <UEmpty v-else-if="loading" variant="naked">
    <template #leading>
      <UIcon name="i-lucide-loader-circle" class="size-8 animate-spin" aria-hidden="true" />
    </template>
    <template #description>
      <p role="status">{{ loadingLabel }}</p>
    </template>
  </UEmpty>
  <UEmpty
    v-else-if="empty"
    variant="naked"
    :icon="emptyIcon ?? 'i-lucide-inbox'"
    :title="emptyTitle"
    :description="emptyDescription"
  >
    <template v-if="$slots['empty-actions']" #actions>
      <slot name="empty-actions" />
    </template>
  </UEmpty>
</template>
