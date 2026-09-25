<script setup lang="ts">
import { CONTAINER_BALANCES_PAGE_SIZE, formatInstantInLima, limaDayStart } from "@yacco/shared";
import type { ContainerBalanceRow, ContainerType, Page } from "@yacco/shared";

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
const uncountedOnly = ref(false);
const withDiscrepancies = ref(false);
const countedBeforeDay = ref("");

const list = usePagedList<ContainerBalanceRow>(
  "/container-balances",
  CONTAINER_BALANCES_PAGE_SIZE,
  computed(() => ({
    search: search.value,
    zoneId: zoneFilter.value === ALL_ZONES ? undefined : zoneFilter.value,
    uncountedOnly: uncountedOnly.value ? true : undefined,
    withDiscrepancies: withDiscrepancies.value ? true : undefined,
    countedBefore: limaDayStart(countedBeforeDay.value),
  })),
);
function clearFilters(): void {
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
</script>

<template>
  <AppPage title="Envases en poder de clientes">
    <p role="status" class="-mt-2 text-muted">{{ progressText }}</p>

    <div class="mt-6 space-y-6">
      <UCard :ui="{ body: 'p-0 sm:p-0' }">
        <div class="flex flex-wrap items-end gap-4 border-b border-default p-4">
          <UFormField label="Buscar" class="min-w-56 flex-1">
            <UInput
              v-model="searchInput"
              type="search"
              icon="i-lucide-search"
              placeholder="Nombre o teléfono"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Zona">
            <USelect v-model="zoneFilter" :items="zoneItems" class="w-48" />
          </UFormField>
          <UCheckbox v-model="uncountedOnly" label="Solo sin contar" />
          <UCheckbox v-model="withDiscrepancies" label="Solo con entregas sin registrar" />
          <UFormField label="Contadas antes del">
            <UInput v-model="countedBeforeDay" type="date" />
          </UFormField>
          <UButton
            v-if="list.hasFilters.value"
            color="neutral"
            variant="ghost"
            icon="i-lucide-x"
            label="Limpiar filtros"
            @click="clearFilters"
          />
        </div>

        <div class="space-y-2 p-4 pb-0">
          <p class="text-sm text-muted">{{ summary }}</p>
          <UAlert
            v-if="lastRegisteredLocation"
            role="status"
            color="success"
            variant="subtle"
            :title="`Conteo registrado: ${lastRegisteredLocation}.`"
          />
        </div>

        <UAlert
          v-if="list.slow.value && list.loading.value"
          role="status"
          color="neutral"
          variant="subtle"
          class="rounded-none"
          :title="SLOW_REQUEST_MESSAGE"
        />

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
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <caption class="sr-only">
                Envases en poder de cada ubicación de cliente y última vez que se contaron
              </caption>
              <thead class="bg-elevated text-left text-xs tracking-wide text-muted uppercase">
                <tr>
                  <th scope="col" class="px-4 py-2 font-medium">Cliente</th>
                  <th scope="col" class="px-4 py-2 font-medium">Ubicación</th>
                  <th scope="col" class="px-4 py-2 font-medium">Zona</th>
                  <th scope="col" class="px-4 py-2 text-right font-medium">Envases</th>
                  <th scope="col" class="px-4 py-2 font-medium">Última vez que se contó</th>
                  <th scope="col" class="px-4 py-2">
                    <span class="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-default">
                <template v-for="row in list.items.value" :key="row.location.id">
                  <tr>
                    <td class="px-4 py-3">
                      <p class="font-medium text-highlighted">{{ row.customer.name }}</p>
                      <UBadge
                        v-if="!row.customer.active"
                        color="warning"
                        variant="subtle"
                        label="Cliente de baja"
                      />
                    </td>
                    <td class="px-4 py-3">
                      <p>{{ row.location.name }}</p>
                      <UBadge
                        v-if="!row.location.active"
                        color="warning"
                        variant="subtle"
                        label="Ubicación retirada"
                      />
                    </td>
                    <td class="px-4 py-3">
                      <UBadge
                        v-if="row.zone"
                        color="neutral"
                        variant="subtle"
                        :label="row.zone.name"
                      />
                      <span v-else class="text-muted">Sin zona</span>
                    </td>
                    <td class="px-4 py-3 text-right">
                      <p class="font-semibold tabular-nums text-highlighted">
                        {{ row.totalQuantity }}
                      </p>
                      <p v-if="row.containers.length > 0" class="text-muted">
                        <template
                          v-for="(container, index) in row.containers"
                          :key="container.containerType.id"
                        >
                          <span v-if="index > 0"> · </span>
                          <span
                            v-if="container.quantity < 0"
                            :aria-label="`${container.quantity} ${container.containerType.name}: el cliente devolvió más envases de los que se le registraron, falta registrar una entrega`"
                            class="text-error"
                          >
                            {{ container.quantity }} {{ container.containerType.name }}
                          </span>
                          <span v-else
                            >{{ container.quantity }} {{ container.containerType.name }}</span
                          >
                        </template>
                      </p>
                      <UBadge
                        v-if="row.containers.some((c) => c.quantity < 0)"
                        color="error"
                        variant="subtle"
                        label="Entrega sin registrar"
                      />
                    </td>
                    <td class="px-4 py-3">
                      <UBadge
                        v-if="row.lastCountedAt === null"
                        color="info"
                        variant="subtle"
                        label="Sin contar"
                      />
                      <template v-else>
                        <p class="tabular-nums">{{ formatInstantInLima(row.lastCountedAt) }}</p>
                        <UBadge
                          v-if="daysSince(row.lastCountedAt, Date.now()) > OLD_COUNT_DAYS"
                          color="warning"
                          variant="subtle"
                          :label="`Hace más de ${OLD_COUNT_DAYS} días`"
                        />
                      </template>
                    </td>
                    <td class="px-4 py-3 text-right">
                      <UButton
                        v-if="countingLocationId !== row.location.id"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        label="Contar"
                        @click="startCount(row)"
                      />
                    </td>
                  </tr>
                  <tr v-if="countingLocationId === row.location.id">
                    <td colspan="6" class="px-4 pb-4">
                      <ContainerCountForm
                        :row="row"
                        :container-types="catalog.items.value"
                        @cancel="countingLocationId = null"
                        @registered="registered(row)"
                      />
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
          <ListPagination
            :shown-page="list.shownPage.value"
            :page="list.page.value"
            :total-pages="list.totalPages.value"
            @previous="list.previous"
            @next="list.next"
          />
        </template>
      </UCard>
    </div>
  </AppPage>
</template>
