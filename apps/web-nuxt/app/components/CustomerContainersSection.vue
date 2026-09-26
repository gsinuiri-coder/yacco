<script setup lang="ts">
import { formatInstantInLima } from "@yacco/shared";
import type { ContainerBalanceRow, LocationContainerBalance, Page } from "@yacco/shared";

/**
 * Los envases de UN cliente: su saldo por tipo en cada ubicación y cuándo se
 * contó por última vez. Lee el mismo reporte que «Envases en poder de
 * clientes», filtrado por cliente, así que las dos pantallas no pueden decir
 * cosas distintas. Contar se hace allá: el enlace la abre ya filtrada.
 *
 * Para el administrador y el vendedor, los mismos roles que el reporte (quien
 * anota los conteos en la oficina tiene que ver a quién contar: supuesto 20).
 * La ficha no la monta para otro rol.
 */
const props = defineProps<{ customerId: string }>();

// Un cliente con más de 100 ubicaciones no existe en la planta; el tope es el de la API.
const LOCATIONS_LIMIT = 100;

const api = useApi();
const rows = ref<ContainerBalanceRow[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    const page = await api.request<Page<ContainerBalanceRow>>("/container-balances", {
      query: { customerId: props.customerId, limit: LOCATIONS_LIMIT },
    });
    rows.value = page.data;
  } catch (error) {
    loadError.value = describeApiFailure(error);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

function describeContainers(containers: LocationContainerBalance[]): string {
  return containers
    .map((container) => `${container.quantity} ${container.containerType.name}`)
    .join(" · ");
}

const countLink = computed(() => `/container-counts?customerId=${props.customerId}`);
</script>

<template>
  <SectionCard title="Envases" description="Los que tiene en cada ubicación, por tipo.">
    <template #actions>
      <UButton
        :to="countLink"
        color="neutral"
        variant="outline"
        size="sm"
        icon="i-lucide-clipboard-check"
        label="Contarlo"
        aria-label="Contarlo en Envases en poder de clientes"
      />
    </template>

    <ListStatus
      v-if="loadError || loading || rows.length === 0"
      :error-message="loadError"
      :loading="loading"
      :empty="rows.length === 0"
      loading-label="Cargando envases…"
      empty-icon="i-lucide-package"
      empty-title="Sin ubicaciones"
      empty-description="Este cliente no tiene ubicaciones donde dejarle envases."
      @retry="load"
    />

    <ul v-else class="divide-y divide-default">
      <li
        v-for="row in rows"
        :key="row.location.id"
        class="flex flex-wrap items-start justify-between gap-2 py-3"
      >
        <div>
          <p class="font-medium text-highlighted">{{ row.location.name }}</p>
          <UBadge
            v-if="!row.location.active"
            color="warning"
            variant="subtle"
            label="Ubicación retirada"
          />
          <p v-if="row.containers.length > 0" class="text-sm tabular-nums">
            {{ describeContainers(row.containers) }}
          </p>
          <p v-else class="text-sm text-muted">Sin envases registrados</p>
          <UBadge
            v-if="row.containers.some((container) => container.quantity < 0)"
            color="error"
            variant="subtle"
            label="Entrega sin registrar"
          />
        </div>
        <UBadge
          v-if="row.lastCountedAt === null"
          color="info"
          variant="subtle"
          label="Sin contar"
        />
        <p v-else class="text-sm text-muted tabular-nums">
          Contado el {{ formatInstantInLima(row.lastCountedAt) }}
        </p>
      </li>
    </ul>
  </SectionCard>
</template>
