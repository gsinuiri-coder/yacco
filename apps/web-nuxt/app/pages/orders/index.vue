<script setup lang="ts">
import { ORDERS_PAGE_SIZE, formatCalendarDay } from "@yacco/shared";
import type { Customer, Order, OrderStatus } from "@yacco/shared";
import type { TableColumn } from "@nuxt/ui";

useHead({ title: "Pedidos · Yacco" });

type StatusFilter = OrderStatus | "all";
const STATUS_ITEMS = [
  { label: "Todos", value: "all" },
  ...(Object.entries(ORDER_STATUS) as Array<[OrderStatus, { label: string }]>).map(
    ([value, { label }]) => ({ label, value }),
  ),
];

const status = ref<StatusFilter>("all");
// "AAAA-MM-DD" tal cual lo da el campo de fecha: nunca pasa por Date.
const deliveryDateFrom = ref("");
const deliveryDateTo = ref("");
const customer = ref<Customer | null>(null);

const list = usePagedList<Order>(
  "/orders",
  ORDERS_PAGE_SIZE,
  computed(() => ({
    status: status.value === "all" ? undefined : status.value,
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
  {
    accessorKey: "total",
    header: "Total",
    meta: { class: { th: "text-right", td: "text-right" } },
  },
];

function openOrder(_event: Event, row: { original: Order }): void {
  void navigateTo(`/orders/${row.original.id}`);
}
</script>

<template>
  <AppPage title="Pedidos" :description="summary">
    <template #actions>
      <UButton to="/orders/new" icon="i-lucide-plus" label="Nuevo pedido" />
    </template>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div class="flex flex-wrap items-end gap-4 border-b border-default p-4">
        <UFormField label="Estado" class="w-44">
          <USelect
            v-model="status"
            :content="NON_BLOCKING_SELECT"
            :items="STATUS_ITEMS"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Entrega desde">
          <UInput v-model="deliveryDateFrom" type="date" />
        </UFormField>
        <UFormField label="Entrega hasta">
          <UInput v-model="deliveryDateTo" type="date" />
        </UFormField>
        <div class="min-w-64 flex-1">
          <CustomerPicker v-model="customer" label="Cliente" />
        </div>
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
          :ui="{ caption: 'sr-only', tr: 'cursor-pointer' }"
          @select="openOrder"
        >
          <template #customer-cell="{ row }">
            <NuxtLink
              :to="`/orders/${row.original.id}`"
              class="font-medium text-highlighted hover:text-primary"
              :aria-label="`Ver pedido de ${row.original.customer.name}`"
              >{{ row.original.customer.name }}</NuxtLink
            >
            <p class="text-sm text-muted">{{ row.original.customer.phone }}</p>
          </template>
          <template #deliveryDate-cell="{ row }">
            <span class="tabular-nums">{{ formatCalendarDay(row.original.deliveryDate) }}</span>
          </template>
          <template #status-cell="{ row }">
            <UBadge
              :color="ORDER_STATUS[row.original.status].color"
              variant="subtle"
              :label="ORDER_STATUS[row.original.status].label"
            />
          </template>
          <template #items-cell="{ row }">
            <span class="text-sm text-muted">{{ itemsSummary(row.original) }}</span>
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
