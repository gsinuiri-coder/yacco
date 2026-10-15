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

    <UPageList v-else>
      <li v-for="row in rows" :key="row.location.id">
        <UPageCard
          :title="row.location.name"
          :description="
            row.containers.length > 0
              ? describeContainers(row.containers)
              : 'Sin envases registrados'
          "
          variant="soft"
        >
          <UFieldGroup>
            <UBadge
              v-if="!row.location.active"
              color="warning"
              variant="subtle"
              label="Ubicación retirada"
            />
            <UBadge
              v-if="row.containers.some((container) => container.quantity < 0)"
              color="error"
              variant="subtle"
              label="Entrega sin registrar"
            />
          </UFieldGroup>
          <UBadge
            v-if="row.lastCountedAt === null"
            color="info"
            variant="subtle"
            label="Sin contar"
          />
          <UAlert
            v-else
            color="neutral"
            variant="soft"
            :title="`Contado el ${formatInstantInLima(row.lastCountedAt)}`"
          />
        </UPageCard>
      </li>
    </UPageList>
  </SectionCard>
</template>
