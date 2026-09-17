<script setup lang="ts">
import { CUSTOMERS_PAGE_SIZE } from "@yacco/shared";
import type { Customer } from "@yacco/shared";
import type { TableColumn } from "@nuxt/ui";

useHead({ title: "Clientes · Yacco" });

type StatusFilter = "all" | "active" | "inactive";
const STATUS_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "active", label: "Activos" },
  { value: "inactive", label: "Desactivados" },
] as const;
const ACTIVE_BY_STATUS: Record<StatusFilter, boolean | undefined> = {
  all: undefined,
  active: true,
  inactive: false,
};

const searchInput = ref("");
const search = useDebounced(
  computed(() => searchInput.value.trim()),
  300,
);
const status = ref<StatusFilter>("all");

const list = usePagedList<Customer>(
  "/customers",
  CUSTOMERS_PAGE_SIZE,
  computed(() => ({ search: search.value, active: ACTIVE_BY_STATUS[status.value] })),
);

const summary = computed(() => {
  if (list.firstLoad.value) return "Cargando…";
  const total = list.total.value;
  const noun = total === 1 ? "cliente" : "clientes";
  return `${total} ${noun}${list.hasFilters.value ? " con este filtro" : ""}`;
});

const columns: TableColumn<Customer>[] = [
  { accessorKey: "name", header: "Cliente" },
  { accessorKey: "zone", header: "Zona" },
  { accessorKey: "active", header: "Estado" },
  {
    accessorKey: "debtBalance",
    header: "Deuda",
    meta: { class: { th: "text-right", td: "text-right" } },
  },
  { id: "actions", header: "", meta: { class: { td: "text-right w-0" } } },
];

function openCustomer(_event: Event, row: { original: Customer }): void {
  void navigateTo(`/customers/${row.original.id}`);
}
</script>

<template>
  <AppPage title="Clientes" :description="summary">
    <template #actions>
      <UButton to="/customers/new" icon="i-lucide-user-plus" label="Nuevo cliente" />
    </template>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div class="flex flex-wrap items-end gap-4 border-b border-default p-4">
        <UFormField label="Buscar" class="min-w-64 flex-1">
          <UInput
            v-model="searchInput"
            type="search"
            icon="i-lucide-search"
            placeholder="Nombre o teléfono"
            class="w-full"
          />
        </UFormField>
        <SegmentedFilter v-model="status" label="Estado" :options="STATUS_OPTIONS" />
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
        loading-label="Cargando clientes…"
        empty-icon="i-lucide-users"
        :empty-title="
          list.hasFilters.value
            ? 'Ningún cliente coincide con la búsqueda'
            : 'Todavía no hay clientes'
        "
        :empty-description="
          list.hasFilters.value
            ? 'Prueba con otro nombre o teléfono, o cambia el filtro de estado.'
            : 'Registra el primero para empezar a organizar el reparto.'
        "
        @retry="list.retry"
      >
        <template v-if="!list.hasFilters.value" #empty-actions>
          <UButton to="/customers/new" icon="i-lucide-user-plus" label="Nuevo cliente" />
        </template>
      </ListStatus>

      <template v-else>
        <UTable
          :data="list.items.value"
          :columns="columns"
          caption="Clientes registrados con su zona y su deuda"
          :ui="{ caption: 'sr-only', tr: 'cursor-pointer' }"
          @select="openCustomer"
        >
          <template #name-cell="{ row }">
            <NuxtLink
              :to="`/customers/${row.original.id}`"
              class="font-medium text-highlighted hover:text-primary"
              >{{ row.original.name }}</NuxtLink
            >
            <p class="text-sm text-muted">{{ row.original.phone }}</p>
          </template>
          <template #zone-cell="{ row }">
            <UBadge
              v-if="row.original.zone"
              color="neutral"
              variant="soft"
              :label="row.original.zone.name"
            />
            <span v-else class="text-sm text-dimmed">Sin zona</span>
          </template>
          <template #active-cell="{ row }">
            <UBadge
              :color="row.original.active ? 'success' : 'neutral'"
              variant="subtle"
              :label="row.original.active ? 'Activo' : 'Desactivado'"
            />
          </template>
          <template #debtBalance-cell="{ row }">
            <MoneyAmount :value="row.original.debtBalance" debt />
          </template>
          <template #actions-cell="{ row }">
            <UButton
              :to="`/customers/${row.original.id}/edit`"
              color="neutral"
              variant="ghost"
              icon="i-lucide-pencil"
              label="Editar"
              :aria-label="`Editar ${row.original.name}`"
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
  </AppPage>
</template>
