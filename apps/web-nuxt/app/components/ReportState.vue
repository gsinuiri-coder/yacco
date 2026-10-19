<script setup lang="ts">
/**
 * El marco de un reporte: el aviso de que es solo para administradores, y
 * mientras no hay filas que mostrar, la carga, el error con reintento o el
 * vacío (ListStatus). Cuando hay filas, pinta el slot.
 */
defineProps<{
  isAdmin: boolean;
  loading: boolean;
  slow: boolean;
  errorMessage: string | null;
  empty: boolean;
  emptyTitle: string;
  emptyDescription: string;
}>();
defineEmits<{ retry: [] }>();
</script>

<template>
  <UAlert
    v-if="!isAdmin"
    color="neutral"
    variant="outline"
    title="Este reporte es solo para administradores"
    description="Lo revisa el dueño de la planta."
  />
  <UPageBody v-else>
    <UAlert
      v-if="slow && loading"
      role="status"
      color="neutral"
      variant="subtle"
      :title="SLOW_REQUEST_MESSAGE"
    />
    <UCard>
      <ListStatus
        v-if="loading || errorMessage || empty"
        :error-message="errorMessage"
        :loading="loading"
        :empty="empty"
        loading-label="Cargando el reporte…"
        error-title="No se pudo cargar el reporte"
        :empty-title="emptyTitle"
        :empty-description="emptyDescription"
        @retry="$emit('retry')"
      />
      <slot v-else />
    </UCard>
  </UPageBody>
</template>
