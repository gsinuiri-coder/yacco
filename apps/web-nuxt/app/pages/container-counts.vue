<script setup lang="ts">
import { CONTAINER_BALANCES_PAGE_SIZE, formatInstantInLima, limaDayStart } from "@yacco/shared";
import type { ContainerBalanceRow, ContainerType, Page } from "@yacco/shared";
import type { TableColumn } from "@nuxt/ui";

/**
 * La lista de trabajo del cuadre de envases: ~750 envases en ~500
 * ubicaciones de cliente, contadas una por una. El dueño la abre preguntando
 * "¿quién falta?", así que lo que comunica siempre es el avance —contadas
 * contra el total del padrón entero, independiente de la página o el
 * filtro en pantalla— y el estado de cada fila: nunca contada, contada (y
 * hace cuánto), un saldo negativo (una entrega que nadie registró), un
 * cliente o ubicación de baja (a propósito visibles, marcados, nunca
 * escondidos). El conteo pasa dentro de la fila; después se recarga la
 * misma página del reporte, así que el saldo y la fecha en pantalla
 * siempre vienen de la API.
 *
 * Se recorre por zona (el catálogo sale de GET /zones) y se busca a UN
 * cliente por nombre o teléfono: con ~600 ubicaciones, contar lo que un
 * chofer anotó de un cliente no puede exigir pasar treinta páginas.
 */
useHead({ title: "Envases en poder de clientes · Yacco" });

const api = useApi();

const searchInput = ref("");
const search = useDebounced(
  computed(() => searchInput.value.trim()),
  300,
);
const ALL_ZONES = "all";
const zoneFilter = ref(ALL_ZONES);
const zones = useActiveZones();
const zoneItems = computed(() => [
  { label: "Todas las zonas", value: ALL_ZONES },
  ...zones.value.map((zone) => ({ label: zone.name, value: zone.id })),
]);
// Abierta desde la ficha de un cliente (`?customerId=`): solo sus ubicaciones,
// dicho arriba, hasta que se pida ver todas o se limpien los filtros.
const route = useRoute();
const customerFilter = ref(
  typeof route.query.customerId === "string" ? route.query.customerId : undefined,
);
// Abierta desde «Puesta en marcha» del Panel (`?uncountedOnly=true`): solo las que faltan contar.
const uncountedOnly = ref(route.query.uncountedOnly === "true");
const withDiscrepancies = ref(false);
const countedBeforeDay = ref("");

const list = usePagedList<ContainerBalanceRow>(
  "/container-balances",
  CONTAINER_BALANCES_PAGE_SIZE,
  computed(() => ({
    search: search.value,
    customerId: customerFilter.value,
    zoneId: zoneFilter.value === ALL_ZONES ? undefined : zoneFilter.value,
    uncountedOnly: uncountedOnly.value ? true : undefined,
    withDiscrepancies: withDiscrepancies.value ? true : undefined,
    countedBefore: limaDayStart(countedBeforeDay.value),
  })),
);
// El nombre sale de la primera fila; sin filas (un cliente sin ubicaciones, o
// otro filtro que las deja afuera) el aviso igual se ve, sin nombre.
const filteredCustomerName = computed(() => list.items.value[0]?.customer.name);
function showEveryone(): void {
  customerFilter.value = undefined;
  void navigateTo("/container-counts", { replace: true });
}
function clearFilters(): void {
  if (customerFilter.value !== undefined) showEveryone();
  searchInput.value = "";
  zoneFilter.value = ALL_ZONES;
  uncountedOnly.value = false;
  withDiscrepancies.value = false;
  countedBeforeDay.value = "";
}
const summary = computed(() => {
  if (list.firstLoad.value) return "Cargando…";
  const total = list.total.value;
  return `${total} ${total === 1 ? "ubicación" : "ubicaciones"}${list.hasFilters.value ? " con este filtro" : ""}`;
});

// El avance es sobre TODO el padrón, así que se pide aparte del listado
// filtrado: dos pedidos de una fila cuyo `total` es el número que importa.
const progress = ref<{ total: number; uncounted: number } | null>(null);
async function loadProgress(): Promise<void> {
  try {
    const [all, uncounted] = await Promise.all([
      api.request<Page<ContainerBalanceRow>>("/container-balances", {
        query: { page: 1, limit: 1 },
      }),
      api.request<Page<ContainerBalanceRow>>("/container-balances", {
        query: { page: 1, limit: 1, uncountedOnly: true },
      }),
    ]);
    progress.value = { total: all.total, uncounted: uncounted.total };
  } catch {
    // El propio estado de error de la lista cubre la falla; el avance queda desconocido.
    progress.value = null;
  }
}
onMounted(loadProgress);
const progressText = computed(() => {
  if (progress.value === null) return "Calculando el avance…";
  const { total, uncounted } = progress.value;
  return `${total - uncounted} de ${total} ubicaciones contadas · ${uncounted} sin contar`;
});

// Sin catálogo, la planilla igual ofrece los tipos que ya trae el reporte;
// sólo "otro tipo encontrado" queda sin disponible.
const catalog = useCatalog<ContainerType>("/container-types");

const countingLocationId = ref<string | null>(null);
const lastRegisteredLocation = ref<string | null>(null);

function startCount(row: ContainerBalanceRow): void {
  countingLocationId.value = row.location.id;
  lastRegisteredLocation.value = null;
}
function registered(row: ContainerBalanceRow): void {
  countingLocationId.value = null;
  lastRegisteredLocation.value = `${row.customer.name} — ${row.location.name}`;
  list.retry();
  void loadProgress();
}

const columns: TableColumn<ContainerBalanceRow>[] = [
  { id: "customer", header: "Cliente" },
  { id: "location", header: "Ubicación" },
  { id: "zone", header: "Zona" },
  { id: "containers", header: "Envases", meta: RIGHT_ALIGNED },
  { id: "lastCountedAt", header: "Última vez que se contó" },
  { id: "actions", header: hiddenHeader("Acciones"), meta: RIGHT_ALIGNED },
];
// La planilla de conteo se abre debajo de su fila, de a una.
const expandedLocationIds = computed<Record<string, boolean>>(() =>
  countingLocationId.value === null ? {} : { [countingLocationId.value]: true },
);
</script>

<template>
  <AppPage title="Envases en poder de clientes">
    <UPageBody>
      <p role="status">{{ progressText }}</p>

      <UCard>
        <template #header>
          <UPageGrid>
            <UFormField label="Buscar">
              <UInput
                v-model="searchInput"
                type="search"
                icon="i-lucide-search"
                placeholder="Nombre o teléfono"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Zona">
              <USelect v-model="zoneFilter" :items="zoneItems" class="w-full" />
            </UFormField>
            <UCheckbox v-model="uncountedOnly" label="Solo sin contar" />
            <UCheckbox v-model="withDiscrepancies" label="Solo con entregas sin registrar" />
            <UFormField label="Contadas antes del">
              <UInput v-model="countedBeforeDay" type="date" class="w-full" />
            </UFormField>
            <UButton
              v-if="list.hasFilters.value"
              color="neutral"
              variant="ghost"
              icon="i-lucide-x"
              label="Limpiar filtros"
              @click="clearFilters"
            />
          </UPageGrid>
        </template>

        <UPageBody>
          <UAlert
            v-if="customerFilter"
            color="neutral"
            variant="subtle"
            :title="`Solo las ubicaciones de ${filteredCustomerName ?? 'un cliente'}, abierto desde su ficha.`"
            :actions="[
              { label: 'Ver todas', color: 'neutral', variant: 'link', onClick: showEveryone },
            ]"
          />
          <p>{{ summary }}</p>
          <UAlert
            v-if="lastRegisteredLocation"
            role="status"
            color="success"
            variant="subtle"
            :title="`Conteo registrado: ${lastRegisteredLocation}.`"
          />

          <UAlert
            v-if="list.slow.value && list.loading.value"
            role="status"
            color="neutral"
            variant="subtle"
            :title="SLOW_REQUEST_MESSAGE"
          />
        </UPageBody>

        <ListStatus
          v-if="list.errorMessage.value || list.firstLoad.value || list.items.value.length === 0"
          :error-message="list.errorMessage.value"
          :loading="list.firstLoad.value"
          :empty="list.items.value.length === 0"
          loading-label="Cargando ubicaciones…"
          empty-icon="i-lucide-package-search"
          :empty-title="
            list.hasFilters.value
              ? 'Ninguna ubicación con este filtro'
              : 'Todavía no hay ubicaciones'
          "
          :empty-description="
            list.hasFilters.value
              ? 'Cambia o limpia los filtros.'
              : 'Las ubicaciones de los clientes aparecerán aquí para contarlas.'
          "
          @retry="list.retry"
        />

        <template v-else>
          <UTable
            :data="list.items.value"
            :columns="columns"
            :get-row-id="(row: ContainerBalanceRow) => row.location.id"
            :expanded="expandedLocationIds"
            caption="Envases en poder de cada ubicación de cliente y última vez que se contaron"
          >
            <template #customer-cell="{ row }">
              <p>{{ row.original.customer.name }}</p>
              <UBadge
                v-if="!row.original.customer.active"
                color="warning"
                variant="subtle"
                label="Cliente de baja"
              />
            </template>
            <template #location-cell="{ row }">
              <p>{{ row.original.location.name }}</p>
              <UBadge
                v-if="!row.original.location.active"
                color="warning"
                variant="subtle"
                label="Ubicación retirada"
              />
            </template>
            <template #zone-cell="{ row }">
              <UBadge
                v-if="row.original.zone"
                color="neutral"
                variant="subtle"
                :label="row.original.zone.name"
              />
              <template v-else>Sin zona</template>
            </template>
            <template #containers-cell="{ row }">
              <p>{{ row.original.totalQuantity }}</p>
              <p v-if="row.original.containers.length > 0">
                <template
                  v-for="(container, index) in row.original.containers"
                  :key="container.containerType.id"
                >
                  <span v-if="index > 0"> · </span>
                  <UBadge
                    v-if="container.quantity < 0"
                    color="error"
                    variant="subtle"
                    :aria-label="`${container.quantity} ${container.containerType.name}: el cliente devolvió más envases de los que se le registraron, falta registrar una entrega`"
                    :label="`${container.quantity} ${container.containerType.name}`"
                  />
                  <span v-else>{{ container.quantity }} {{ container.containerType.name }}</span>
                </template>
              </p>
              <UBadge
                v-if="row.original.containers.some((c) => c.quantity < 0)"
                color="error"
                variant="subtle"
                label="Entrega sin registrar"
              />
            </template>
            <template #lastCountedAt-cell="{ row }">
              <UBadge
                v-if="row.original.lastCountedAt === null"
                color="info"
                variant="subtle"
                label="Sin contar"
              />
              <template v-else>
                <p>{{ formatInstantInLima(row.original.lastCountedAt) }}</p>
                <UBadge
                  v-if="daysSince(row.original.lastCountedAt, Date.now()) > OLD_COUNT_DAYS"
                  color="warning"
                  variant="subtle"
                  :label="`Hace más de ${OLD_COUNT_DAYS} días`"
                />
              </template>
            </template>
            <template #actions-cell="{ row }">
              <UButton
                v-if="countingLocationId !== row.original.location.id"
                color="neutral"
                variant="ghost"
                size="sm"
                label="Contar"
                @click="startCount(row.original)"
              />
            </template>
            <template #expanded="{ row }">
              <ContainerCountForm
                :row="row.original"
                :container-types="catalog.items.value"
                @cancel="countingLocationId = null"
                @registered="registered(row.original)"
              />
            </template>
          </UTable>
          <ListPagination
            :shown-page="list.shownPage.value"
            :page="list.page.value"
            :total-pages="list.totalPages.value"
            @previous="list.previous"
            @next="list.next"
          />
        </template>
      </UCard>
    </UPageBody>
  </AppPage>
</template>
