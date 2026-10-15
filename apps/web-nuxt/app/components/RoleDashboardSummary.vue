<script setup lang="ts">
import type { RoleDashboard } from "@yacco/shared";

/**
 * El resumen del día de quien mira, según sus roles (Fase 3, fila 9a). La API
 * decide qué números le tocan; acá solo se muestran, cada uno con el enlace a
 * la pantalla donde se ve su detalle. Si la consulta falla, se dice y se
 * puede reintentar: el resto del Panel sigue.
 */
const api = useApi();
const dashboard = ref<RoleDashboard | null>(null);
const errorMessage = ref<string | null>(null);

async function load(): Promise<void> {
  errorMessage.value = null;
  try {
    dashboard.value = await api.request<RoleDashboard>("/reports/dashboard");
  } catch (error) {
    errorMessage.value = describeApiFailure(error);
  }
}
onMounted(load);

const tiles = computed(() => (dashboard.value === null ? [] : dashboardTiles(dashboard.value)));
</script>

<template>
  <section aria-label="Resumen del día">
    <UAlert
      v-if="errorMessage"
      role="alert"
      color="error"
      variant="subtle"
      title="No se pudo cargar el resumen del día"
      :description="errorMessage"
      :actions="[{ label: 'Reintentar', color: 'neutral', variant: 'outline', onClick: load }]"
    />
    <UPageGrid v-else-if="tiles.length > 0">
      <UPageCard
        v-for="tile in tiles"
        :key="tile.label"
        :title="tile.value"
        :description="tile.label"
        :to="tile.to"
        :aria-label="`${tile.label}: ${tile.value}`"
        variant="subtle"
      />
    </UPageGrid>
  </section>
</template>
