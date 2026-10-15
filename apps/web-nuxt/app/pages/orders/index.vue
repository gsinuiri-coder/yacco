<script setup lang="ts">
import { ORDERS_PAGE_SIZE, formatCalendarDay } from "@yacco/shared";
import type { Customer, Order, OrderStatus } from "@yacco/shared";
import type { TableColumn } from "@nuxt/ui";

useHead({ title: "Pedidos · Yacco" });

type StatusFilter = OrderStatus | "all" | "not-cancelled";
const STATUS_ITEMS = [
  { label: "Todos", value: "all" },
  { label: "Todos menos anulados", value: "not-cancelled" },
  ...(Object.entries(ORDER_STATUS) as Array<[OrderStatus, { label: string }]>).map(
    ([value, { label }]) => ({ label, value }),
  ),
];
const STATUS_QUERY_ITEMS: readonly (OrderStatus | "NOT_CANCELLED" | "all")[] = [
  "all",
  "NOT_CANCELLED",
  ...(Object.keys(ORDER_STATUS) as OrderStatus[]),
];

// "AAAA-MM-DD" tal cual lo da el campo de fecha: nunca pasa por Date. Puede
// llegar en la URL (los enlaces del Panel).
const query = useRoute().query;
const statusFromQuery = queryChoice(query.status, STATUS_QUERY_ITEMS, "all");
const status = ref<StatusFilter>(
  statusFromQuery === "NOT_CANCELLED" ? "not-cancelled" : statusFromQuery,
);
const deliveryDateFrom = ref(queryText(query.deliveryDateFrom));
const deliveryDateTo = ref(queryText(query.deliveryDateTo));
const customer = ref<Customer | null>(null);

const list = usePagedList<Order>(
  "/orders",
  ORDERS_PAGE_SIZE,
  computed(() => ({
    status: status.value === "all" || status.value === "not-cancelled" ? undefined : status.value,
    excludeCancelled: status.value === "not-cancelled" ? true : undefined,
    deliveryDateFrom: deliveryDateFrom.value,
    deliveryDateTo: deliveryDateTo.value,
    customerId: customer.value?.id,
  })),
);

function clearFilters(): void {
  status.value = "all";
  deliveryDateFrom.value = "";
  deliveryDateTo.value = "";
  customer.value = null;
}

const summary = computed(() => {
  if (list.firstLoad.value) return "Cargando…";
  const total = list.total.value;
  return `${total} ${total === 1 ? "pedido" : "pedidos"}${list.hasFilters.value ? " con este filtro" : ""}`;
});

function itemsSummary(order: Order): string {
  return order.items.map((item) => `${item.quantity}× ${item.product.name}`).join(", ");
}

const columns: TableColumn<Order>[] = [
  { accessorKey: "customer", header: "Cliente" },
  { accessorKey: "deliveryDate", header: "Entrega" },
  { accessorKey: "status", header: "Estado" },
  { accessorKey: "items", header: "Productos" },
  { accessorKey: "total", header: "Total" },
];

function openOrder(_event: Event, row: { original: Order }): void {
  void navigateTo(`/orders/${row.original.id}`);
}
</script>

<template>
  <AppPage title="Pedidos" :description="summary">
    <template #actions>
      <UFieldGroup>
        <UButton
          to="/orders/undelivered"
          color="neutral"
          variant="outline"
          icon="i-lucide-calendar-clock"
          label="No entregados"
        />
        <UButton to="/orders/new" icon="i-lucide-plus" label="Nuevo pedido" />
      </UFieldGroup>
    </template>

    <UCard>
      <template #header>
        <UPageGrid>
          <UFormField label="Estado">
            <USelect v-model="status" :items="STATUS_ITEMS" />
          </UFormField>
          <UFormField label="Entrega desde">
            <UInput v-model="deliveryDateFrom" type="date" />
          </UFormField>
          <UFormField label="Entrega hasta">
            <UInput v-model="deliveryDateTo" type="date" />
          </UFormField>
          <CustomerPicker v-model="customer" label="Cliente" />
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
        loading-label="Cargando pedidos…"
        empty-icon="i-lucide-clipboard-list"
        :empty-title="
          list.hasFilters.value ? 'Ningún pedido coincide con el filtro' : 'Todavía no hay pedidos'
        "
        :empty-description="
          list.hasFilters.value
            ? 'Prueba con otro estado, fecha o cliente.'
            : 'Los pedidos que se tomen aparecerán aquí.'
        "
        @retry="list.retry"
      />

      <template v-else>
        <UTable
          :data="list.items.value"
          :columns="columns"
          caption="Pedidos con cliente, fecha de entrega, estado y productos"
          @select="openOrder"
        >
          <template #customer-cell="{ row }">
            <UUser
              :to="`/orders/${row.original.id}`"
              :name="row.original.customer.name"
              :description="row.original.customer.phone"
              :aria-label="`Ver pedido de ${row.original.customer.name}`"
            />
          </template>
          <template #deliveryDate-cell="{ row }">
            {{ formatCalendarDay(row.original.deliveryDate) }}
          </template>
          <template #status-cell="{ row }">
            <UBadge
              :color="ORDER_STATUS[row.original.status].color"
              variant="subtle"
              :label="ORDER_STATUS[row.original.status].label"
            />
          </template>
          <template #items-cell="{ row }">
            {{ itemsSummary(row.original) }}
          </template>
          <template #total-cell="{ row }">
            <MoneyAmount :value="row.original.total" />
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
