<script setup lang="ts">
import { ORDERS_PAGE_SIZE, formatCalendarDay, nextCalendarDay } from "@yacco/shared";
import type { Order } from "@yacco/shared";
import type { TableColumn } from "@nuxt/ui";

useHead({ title: "No entregados · Yacco" });

const api = useApi();
const deliveryDate = ref("");

const list = usePagedList<Order>(
  "/orders",
  ORDERS_PAGE_SIZE,
  computed(() => ({
    status: "FAILED",
    isRescheduled: false,
    deliveryDateFrom: deliveryDate.value || undefined,
    deliveryDateTo: deliveryDate.value || undefined,
  })),
);

const actionError = ref<string | null>(null);
const actionNotice = ref<string | null>(null);

// Reprogramar individual
const singleModalOpen = ref(false);
const singleOrder = ref<Order | null>(null);
const singleTargetDate = ref("");
const singleLoading = ref(false);
const slowSingle = useSlowRequest(singleLoading);

function openSingleModal(order: Order): void {
  singleOrder.value = order;
  singleTargetDate.value = nextCalendarDay(order.deliveryDate);
  actionError.value = null;
  actionNotice.value = null;
  singleModalOpen.value = true;
}

async function confirmSingleReschedule(): Promise<void> {
  if (!singleOrder.value || singleLoading.value) return;
  singleLoading.value = true;
  actionError.value = null;
  try {
    const res = await api.request<Order>(`/orders/${singleOrder.value.id}/reschedule`, {
      method: "POST",
      body: singleTargetDate.value ? { deliveryDate: singleTargetDate.value } : {},
    });
    singleModalOpen.value = false;
    actionNotice.value = `Pedido de ${singleOrder.value.customer.name} reprogramado para el ${formatCalendarDay(res.deliveryDate)}`;
    await list.retry();
  } catch (error) {
    actionError.value = describeApiFailure(error);
  } finally {
    singleLoading.value = false;
  }
}

// Reprogramar todos los de una fecha
const batchModalOpen = ref(false);
const batchTargetDate = ref("");
const batchLoading = ref(false);
const slowBatch = useSlowRequest(batchLoading);

function openBatchModal(): void {
  if (!deliveryDate.value) return;
  batchTargetDate.value = nextCalendarDay(deliveryDate.value);
  actionError.value = null;
  actionNotice.value = null;
  batchModalOpen.value = true;
}

async function confirmBatchReschedule(): Promise<void> {
  if (!deliveryDate.value || batchLoading.value) return;
  batchLoading.value = true;
  actionError.value = null;
  try {
    const res = await api.request<Order[]>("/orders/reschedule-by-date", {
      method: "POST",
      body: {
        deliveryDate: deliveryDate.value,
        newDeliveryDate: batchTargetDate.value || undefined,
      },
    });
    batchModalOpen.value = false;
    actionNotice.value = `Se reprogramaron ${res.length} pedidos para el ${formatCalendarDay(batchTargetDate.value)}`;
    await list.retry();
  } catch (error) {
    actionError.value = describeApiFailure(error);
  } finally {
    batchLoading.value = false;
  }
}

const summary = computed(() => {
  if (list.firstLoad.value) return "Cargando…";
  const total = list.total.value;
  return `${total} ${total === 1 ? "pedido no entregado sin reprogramar" : "pedidos no entregados sin reprogramar"}`;
});

function itemsSummary(order: Order): string {
  return order.items.map((item) => `${item.quantity}× ${item.product.name}`).join(", ");
}

const columns: TableColumn<Order>[] = [
  { accessorKey: "customer", header: "Cliente" },
  { accessorKey: "location", header: "Local" },
  { accessorKey: "deliveryDate", header: "Fecha original" },
  { accessorKey: "failureReason", header: "Motivo" },
  { accessorKey: "items", header: "Productos" },
  { accessorKey: "total", header: "Total" },
  { id: "actions", header: "Acción" },
];
</script>

<template>
  <AppPage title="No entregados" :description="summary">
    <template #actions>
      <UButton
        to="/orders"
        color="neutral"
        variant="ghost"
        icon="i-lucide-arrow-left"
        label="Volver a pedidos"
      />
    </template>

    <UAlert
      v-if="actionNotice"
      role="status"
      color="info"
      variant="subtle"
      icon="i-lucide-info"
      :title="actionNotice"
    />
    <UAlert v-if="actionError" role="alert" color="error" variant="subtle" :title="actionError" />

    <UCard>
      <template #header>
        <UPageGrid>
          <UFormField label="Fecha de reparto">
            <UInput v-model="deliveryDate" type="date" />
          </UFormField>
          <UButton
            v-if="deliveryDate"
            color="neutral"
            variant="ghost"
            icon="i-lucide-x"
            label="Ver todas las fechas"
            @click="deliveryDate = ''"
          />
          <UButton
            v-if="deliveryDate && list.items.value.length > 0"
            color="primary"
            variant="solid"
            icon="i-lucide-calendar-clock"
            label="Reprogramar todos"
            @click="openBatchModal"
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
        loading-label="Cargando pedidos no entregados…"
        empty-icon="i-lucide-calendar-check"
        empty-title="No hay pedidos no entregados sin reprogramar"
        empty-description="Todos los pedidos fallidos de esta consulta ya fueron reprogramados o no hubo ninguno."
        @retry="list.retry"
      />

      <template v-else>
        <UTable
          :data="list.items.value"
          :columns="columns"
          caption="Pedidos no entregados pendientes de reprogramar"
        >
          <template #customer-cell="{ row }">
            <UUser
              :to="`/orders/${row.original.id}`"
              :name="row.original.customer.name"
              :description="row.original.customer.phone"
              :aria-label="`Ver pedido de ${row.original.customer.name}`"
            />
          </template>

          <template #location-cell="{ row }">
            {{ row.original.location?.name ?? "Principal" }}
          </template>

          <template #deliveryDate-cell="{ row }">
            {{ formatCalendarDay(row.original.deliveryDate) }}
          </template>

          <template #failureReason-cell="{ row }">
            <UBadge
              color="error"
              variant="subtle"
              :label="row.original.failureReason ?? 'Sin motivo registrado'"
            />
          </template>

          <template #items-cell="{ row }">
            {{ itemsSummary(row.original) }}
          </template>

          <template #total-cell="{ row }">
            <MoneyAmount :value="row.original.total" />
          </template>

          <template #actions-cell="{ row }">
            <UButton
              color="primary"
              variant="outline"
              size="xs"
              icon="i-lucide-calendar-clock"
              label="Reprogramar"
              @click="openSingleModal(row.original)"
            />
          </template>
        </UTable>
      </template>
    </UCard>

    <!-- Modal / Confirmación individual -->
    <UModal v-model:open="singleModalOpen" title="Reprogramar pedido">
      <template #body>
        <UPageBody>
          <p v-if="singleOrder">
            Cliente: <strong>{{ singleOrder.customer.name }}</strong>
            <span v-if="singleOrder.location"> — {{ singleOrder.location.name }}</span>
          </p>
          <p v-if="singleOrder?.failureReason">Motivo original: {{ singleOrder.failureReason }}</p>
          <UFormField label="Nueva fecha de entrega">
            <UInput v-model="singleTargetDate" type="date" />
          </UFormField>
          <UAlert
            v-if="slowSingle && singleLoading"
            role="status"
            color="neutral"
            variant="subtle"
            :title="SLOW_REQUEST_MESSAGE"
          />
        </UPageBody>
      </template>
      <template #footer>
        <UFieldGroup>
          <UButton
            color="neutral"
            variant="outline"
            label="Cancelar"
            :disabled="singleLoading"
            @click="singleModalOpen = false"
          />
          <UButton
            color="primary"
            :disabled="singleLoading || !singleTargetDate"
            :label="singleLoading ? 'Reprogramando…' : 'Confirmar'"
            @click="confirmSingleReschedule"
          />
        </UFieldGroup>
      </template>
    </UModal>

    <!-- Modal / Confirmación por fecha -->
    <UModal v-model:open="batchModalOpen" title="Reprogramar todos los pedidos de la fecha">
      <template #body>
        <UPageBody>
          <p>
            Fecha original:
            <strong>{{ formatCalendarDay(deliveryDate) }}</strong>
          </p>
          <p>
            Se reprogramarán todos los pedidos no entregados de esta fecha en una sola operación
            (todo o nada).
          </p>
          <UFormField label="Nueva fecha de entrega">
            <UInput v-model="batchTargetDate" type="date" />
          </UFormField>
          <UAlert
            v-if="slowBatch && batchLoading"
            role="status"
            color="neutral"
            variant="subtle"
            :title="SLOW_REQUEST_MESSAGE"
          />
        </UPageBody>
      </template>
      <template #footer>
        <UFieldGroup>
          <UButton
            color="neutral"
            variant="outline"
            label="Cancelar"
            :disabled="batchLoading"
            @click="batchModalOpen = false"
          />
          <UButton
            color="primary"
            :disabled="batchLoading || !batchTargetDate"
            :label="batchLoading ? 'Reprogramando todos…' : 'Confirmar todos'"
            @click="confirmBatchReschedule"
          />
        </UFieldGroup>
      </template>
    </UModal>
  </AppPage>
</template>
