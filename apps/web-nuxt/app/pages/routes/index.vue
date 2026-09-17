<script setup lang="ts">
import { ROUTES_PAGE_SIZE, formatCalendarDay } from "@yacco/shared";
import type { Route, RouteStatus, User, Zone } from "@yacco/shared";
import type { TableColumn } from "@nuxt/ui";

useHead({ title: "Rutas · Yacco" });

// Reka Select no admite "" como opción: "todos" viaja como este centinela.
const ALL = "all";

const date = ref("");
const driverId = ref(ALL);
const zoneId = ref(ALL);
const status = ref<RouteStatus | typeof ALL>(ALL);

// Los catálogos de los filtros, cada uno de su endpoint. Si alguno cae, el
// filtro queda sin opciones pero la lista sigue: ninguno hace falta para leer.
const drivers = useCatalog<User>("/users", { role: "DRIVER" });
const zones = useCatalog<Zone>("/zones", { active: true });

const driverItems = computed(() => [
  { label: "Todos", value: ALL },
  ...drivers.items.value.map((driver) => ({ label: driver.name, value: driver.id })),
]);
const zoneItems = computed(() => [
  { label: "Todas", value: ALL },
  ...zones.items.value.map((zone) => ({ label: zone.name, value: zone.id })),
]);
const statusItems = [
  { label: "Todas", value: ALL },
  ...(Object.entries(ROUTE_STATUS) as Array<[RouteStatus, { label: string }]>).map(
    ([value, { label }]) => ({ label, value }),
  ),
];

const list = usePagedList<Route>(
  "/routes",
  ROUTES_PAGE_SIZE,
  computed(() => ({
    date: date.value,
    driverId: driverId.value === ALL ? undefined : driverId.value,
    zoneId: zoneId.value === ALL ? undefined : zoneId.value,
    status: status.value === ALL ? undefined : status.value,
  })),
);

function clearFilters(): void {
  date.value = "";
  driverId.value = ALL;
  zoneId.value = ALL;
  status.value = ALL;
}

const summary = computed(() => {
  if (list.firstLoad.value) return "Cargando…";
  const total = list.total.value;
  return `${total} ${total === 1 ? "ruta" : "rutas"}${list.hasFilters.value ? " con este filtro" : ""}`;
});

const columns: TableColumn<Route>[] = [
  { accessorKey: "date", header: "Día" },
  { accessorKey: "driver", header: "Chofer" },
  { accessorKey: "zone", header: "Zona" },
  { accessorKey: "status", header: "Estado" },
  { accessorKey: "stops", header: "Paradas" },
];

function openRoute(_event: Event, row: { original: Route }): void {
  void navigateTo(`/routes/${row.original.id}`);
}
</script>

<template>
  <AppPage title="Rutas" :description="summary">
    <template #actions>
      <UButton to="/routes/new" icon="i-lucide-route" label="Planificar ruta" />
    </template>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div class="flex flex-wrap items-end gap-4 border-b border-default p-4">
        <UFormField label="Día">
          <UInput v-model="date" type="date" />
        </UFormField>
        <UFormField label="Chofer" class="w-48">
          <USelect v-model="driverId" :items="driverItems" class="w-full" />
        </UFormField>
        <UFormField label="Zona" class="w-44">
          <USelect v-model="zoneId" :items="zoneItems" class="w-full" />
        </UFormField>
        <UFormField label="Estado" class="w-44">
          <USelect v-model="status" :items="statusItems" class="w-full" />
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

      <UAlert
        v-if="list.slow.value && list.loading.value"
        role="status"
        color="neutral"
        variant="subtle"
        class="rounded-none"
        :title="SLOW_REQUEST_MESSAGE"
      />

      <ListStatus
        v-if="list.errorMessage.value || list.loading.value || list.items.value.length === 0"
        :error-message="list.errorMessage.value"
        :loading="list.loading.value"
        :empty="list.items.value.length === 0"
        loading-label="Cargando rutas…"
        empty-icon="i-lucide-truck"
        :empty-title="
          list.hasFilters.value ? 'Ninguna ruta coincide con el filtro' : 'Todavía no hay rutas'
        "
        :empty-description="
          list.hasFilters.value
            ? 'Prueba con otro día, chofer, zona o estado.'
            : 'Planifica la ruta del día para empezar a cargar el camión.'
        "
        @retry="list.retry"
      >
        <template v-if="!list.hasFilters.value" #empty-actions>
          <UButton to="/routes/new" icon="i-lucide-route" label="Planificar ruta" />
        </template>
      </ListStatus>

      <template v-else>
        <UTable
          :data="list.items.value"
          :columns="columns"
          caption="Rutas con día, chofer, zona, estado y cuántas paradas tienen"
          :ui="{ caption: 'sr-only', tr: 'cursor-pointer' }"
          @select="openRoute"
        >
          <template #date-cell="{ row }">
            <NuxtLink
              :to="`/routes/${row.original.id}`"
              class="font-medium text-highlighted tabular-nums hover:text-primary"
              :aria-label="`Ver la ruta de ${row.original.driver.name} del ${formatCalendarDay(row.original.date)}`"
              >{{ formatCalendarDay(row.original.date) }}</NuxtLink
            >
          </template>
          <template #driver-cell="{ row }">{{ row.original.driver.name }}</template>
          <template #zone-cell="{ row }">
            <UBadge
              v-if="row.original.zone"
              color="neutral"
              variant="soft"
              :label="row.original.zone.name"
            />
            <span v-else class="text-sm text-dimmed">Sin zona</span>
          </template>
          <template #status-cell="{ row }">
            <UBadge
              :color="ROUTE_STATUS[row.original.status].color"
              variant="subtle"
              :label="ROUTE_STATUS[row.original.status].label"
            />
          </template>
          <template #stops-cell="{ row }">
            <p class="font-medium text-highlighted">{{ summarizeStops(row.original).total }}</p>
            <p v-if="summarizeStops(row.original).resolved" class="text-sm text-muted">
              {{ summarizeStops(row.original).resolved }}
            </p>
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
  </AppPage>
</template>
