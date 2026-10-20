<script setup lang="ts">
import { SALES_PAGE_SIZE, formatInstantInLima, formatSoles } from "@yacco/shared";
import type { Customer, PaginatedSales, SaleListItem, SaleOrigin } from "@yacco/shared";
import type { TableColumn } from "@nuxt/ui";

useHead({ title: "Ventas · Yacco" });

const query = useRoute().query;
const soldFrom = ref(queryText(query.soldFrom));
const soldTo = ref(queryText(query.soldTo));
const customer = ref<Customer | null>(null);

const list = usePagedList<SaleListItem>(
  "/sales",
  SALES_PAGE_SIZE,
  computed(() => ({
    soldFrom: soldFrom.value,
    soldTo: soldTo.value,
    customerId: customer.value?.id,
  })),
);

const totalAmount = computed(
  () => (list.result.value as PaginatedSales | null)?.totalAmount ?? "0.00",
);
const summary = computed(() => {
  if (list.firstLoad.value) return "Cargando…";
  const total = list.total.value;
  return `${total} ${total === 1 ? "venta" : "ventas"}${list.hasFilters.value ? " con este filtro" : ""}`;
});

function clearFilters(): void {
  soldFrom.value = "";
  soldTo.value = "";
  customer.value = null;
}

const ORIGIN_LABEL: Record<SaleOrigin, string> = {
  ROUTE: "Ruta",
  OFFICE: "Oficina",
  MAQUILA: "Maquila",
  ACCESSORY: "Accesorio",
};

const columns: TableColumn<SaleListItem>[] = [
  { accessorKey: "soldAt", header: "Fecha" },
  { accessorKey: "customer", header: "Cliente" },
  { accessorKey: "origin", header: "Origen" },
  { accessorKey: "items", header: "Productos" },
  { accessorKey: "total", header: "Total" },
  { accessorKey: "voidedAt", header: "Estado" },
];
</script>

<template>
  <AppPage title="Ventas" :description="summary">
    <UCard>
      <UPageGrid>
        <UFormField label="Vendida desde">
          <UInput v-model="soldFrom" type="date" />
        </UFormField>
        <UFormField label="Vendida hasta">
          <UInput v-model="soldTo" type="date" />
        </UFormField>
        <CustomerPicker v-model="customer" label="Cliente" />
      </UPageGrid>
      <template #footer>
        <UButton
          v-if="list.hasFilters.value"
          color="neutral"
          variant="ghost"
          icon="i-lucide-x"
          label="Limpiar filtros"
          @click="clearFilters"
        />
      </template>
    </UCard>

    <UAlert
      color="neutral"
      variant="subtle"
      :title="`Total vigente: ${formatSoles(totalAmount)}`"
      description="Las ventas anuladas se muestran para conservar el historial, pero no forman parte del total."
    />

    <UCard>
      <UAlert
        v-if="list.slow.value && list.loading.value"
        role="status"
        color="neutral"
        variant="subtle"
        :title="SLOW_REQUEST_MESSAGE"
      />

      <ListStatus
        v-if="list.errorMessage.value || list.loading.value || list.items.value.length === 0"
        :error-message="list.errorMessage.value"
        :loading="list.loading.value"
        :empty="list.items.value.length === 0"
        loading-label="Cargando ventas…"
        empty-icon="i-lucide-shopping-bag"
        :empty-title="
          list.hasFilters.value
            ? 'Ninguna venta coincide con el filtro'
            : 'Todavía no hay ventas registradas'
        "
        :empty-description="
          list.hasFilters.value
            ? 'Prueba con otro día o cliente.'
            : 'Las ventas de ruta, oficina, maquila y accesorios aparecerán aquí.'
        "
        @retry="list.retry"
      />

      <template v-else>
        <UTable :data="list.items.value" :columns="columns" caption="Ventas registradas">
          <template #soldAt-cell="{ row }">
            {{ formatInstantInLima(row.original.soldAt) }}
          </template>
          <template #customer-cell="{ row }">
            <p>{{ row.original.customer.name }}</p>
            <p>{{ row.original.location.name }}</p>
          </template>
          <template #origin-cell="{ row }">
            <UBadge color="neutral" variant="subtle" :label="ORIGIN_LABEL[row.original.origin]" />
          </template>
          <template #items-cell="{ row }">
            <span v-if="row.original.items.length === 0">Sin productos detallados</span>
            <ul v-else>
              <li v-for="item in row.original.items" :key="item.product.id">
                {{ item.quantity }}× <span>{{ item.product.name }}</span>
              </li>
            </ul>
          </template>
          <template #total-cell="{ row }">
            <MoneyAmount :value="row.original.total" />
          </template>
          <template #voidedAt-cell="{ row }">
            <UBadge
              :color="row.original.voidedAt === null ? 'success' : 'error'"
              variant="subtle"
              :label="row.original.voidedAt === null ? 'Vigente' : 'Anulada'"
            />
            <p v-if="row.original.voidReason">{{ row.original.voidReason }}</p>
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
