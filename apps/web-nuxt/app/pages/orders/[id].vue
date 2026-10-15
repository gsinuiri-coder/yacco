<script setup lang="ts">
import {
  formatCalendarDay,
  formatInstantInLima,
  formatSoles,
  nextCalendarDay,
  timesQuantity,
} from "@yacco/shared";
import type { Order } from "@yacco/shared";
import type { TableColumn } from "@nuxt/ui";

const route = useRoute();
const orderId = String(route.params.id);
const api = useApi();
const resource = useApiResource<Order>(`/orders/${orderId}`);
const order = resource.data;

useHead(() => ({
  title: order.value ? `Pedido de ${order.value.customer.name} · Yacco` : "Pedido · Yacco",
}));

const confirming = ref(false);
const cancelling = ref(false);
const cancelError = ref<string | null>(null);
const cancelNotice = ref<string | null>(null);
const slowCancel = useSlowRequest(cancelling);

const confirmingReschedule = ref(false);
const rescheduling = ref(false);
const rescheduleDeliveryDate = ref("");
const rescheduleError = ref<string | null>(null);
const rescheduleNotice = ref<string | null>(null);
const slowReschedule = useSlowRequest(rescheduling);

type OrderItem = Order["items"][number];
const itemColumns: TableColumn<OrderItem>[] = [
  { id: "product", header: "Producto", footer: "Total" },
  { accessorKey: "quantity", header: "Cantidad", footer: "" },
  { accessorKey: "unitPrice", header: "Precio unitario", footer: "" },
  {
    id: "subtotal",
    header: "Subtotal",
    footer: () => (order.value ? formatSoles(order.value.total) : ""),
  },
];

function startReschedule(): void {
  if (order.value) {
    rescheduleDeliveryDate.value = nextCalendarDay(order.value.deliveryDate);
  }
  confirmingReschedule.value = true;
}

async function rescheduleOrder(): Promise<void> {
  if (rescheduling.value) return;
  rescheduling.value = true;
  rescheduleError.value = null;
  rescheduleNotice.value = null;
  try {
    const newOrder = await api.request<Order>(`/orders/${orderId}/reschedule`, {
      method: "POST",
      body: rescheduleDeliveryDate.value ? { deliveryDate: rescheduleDeliveryDate.value } : {},
    });
    confirmingReschedule.value = false;
    rescheduleNotice.value = `Pedido reprogramado exitosamente para el ${formatCalendarDay(newOrder.deliveryDate)}`;
    await resource.reload();
  } catch (error) {
    rescheduleError.value = describeApiFailure(error);
  } finally {
    rescheduling.value = false;
  }
}

async function cancel(): Promise<void> {
  // Un doble clic no manda dos PATCH.
  if (cancelling.value) return;
  cancelling.value = true;
  cancelError.value = null;
  cancelNotice.value = null;
  try {
    order.value = await api.request<Order>(`/orders/${orderId}/cancel`, { method: "PATCH" });
    confirming.value = false;
  } catch (error) {
    // 409: el chofer lo sacó de PENDIENTE desde otra pantalla entre la carga y
    // el clic. 404: dejó de existir. Ninguno es un error de quien mira: se
    // recarga para mostrar lo que de verdad pasó, no datos viejos.
    if (error instanceof ApiError && (error.status === 409 || error.status === 404)) {
      if (error.status === 409) cancelNotice.value = error.message;
      confirming.value = false;
      await resource.reload();
    } else {
      cancelError.value = describeApiFailure(error);
    }
  } finally {
    cancelling.value = false;
  }
}
</script>

<template>
  <AppPage
    :title="order ? `Pedido de ${order.customer.name}` : 'Pedido'"
    :description="order ? undefined : 'Cargando…'"
  >
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
      v-if="cancelNotice"
      role="status"
      color="info"
      variant="subtle"
      icon="i-lucide-info"
      :title="cancelNotice"
    />
    <UAlert v-if="cancelError" role="alert" color="error" variant="subtle" :title="cancelError" />

    <UAlert
      v-if="rescheduleNotice"
      role="status"
      color="info"
      variant="subtle"
      icon="i-lucide-info"
      :title="rescheduleNotice"
    />
    <UAlert
      v-if="rescheduleError"
      role="alert"
      color="error"
      variant="subtle"
      :title="rescheduleError"
    />

    <ResourceState
      :loading="resource.loading.value"
      :slow="resource.slow.value"
      :not-found="resource.notFound.value"
      :error-message="resource.errorMessage.value"
      noun="pedido"
      article="el"
      back-to="/orders"
      back-label="Volver a pedidos"
      @retry="resource.reload"
    >
      <UAlert
        v-if="order && order.rescheduledTo"
        role="status"
        color="info"
        variant="subtle"
        icon="i-lucide-calendar-arrow-up"
        :title="`Reprogramado para ${formatCalendarDay(order.rescheduledTo.deliveryDate)}`"
      >
        <template #actions>
          <UButton
            :to="`/orders/${order.rescheduledTo.id}`"
            color="info"
            variant="link"
            label="Ver nuevo pedido"
          />
        </template>
      </UAlert>

      <UAlert
        v-if="order && order.rescheduledFrom"
        role="status"
        color="info"
        variant="subtle"
        icon="i-lucide-calendar-arrow-down"
        :title="`Reprogramación del pedido del ${formatCalendarDay(order.rescheduledFrom.deliveryDate)}`"
      >
        <template #actions>
          <UButton
            :to="`/orders/${order.rescheduledFrom.id}`"
            color="info"
            variant="link"
            label="Ver pedido original"
          />
        </template>
      </UAlert>

      <UAlert
        v-if="order && order.siblingOrders && order.siblingOrders.length > 0"
        role="status"
        color="info"
        variant="subtle"
        icon="i-lucide-store"
        :title="`Parte de un pedido de ${order.siblingOrders.length + 1} locales`"
        description="Otros locales:"
      >
        <template #actions>
          <UFieldGroup>
            <UButton
              v-for="sibling in order.siblingOrders"
              :key="sibling.id"
              :to="`/orders/${sibling.id}`"
              color="info"
              variant="link"
              :label="sibling.locationName"
            />
          </UFieldGroup>
        </template>
      </UAlert>

      <UCard v-if="order">
        <template #header>
          <UPageGrid>
            <UPageCard
              title="Cliente"
              :description="`${order.customer.name} · ${order.customer.phone}`"
              :to="`/customers/${order.customer.id}`"
              variant="soft"
            />
            <UPageCard
              v-if="order.location"
              title="Local"
              :description="order.location.name"
              variant="soft"
            />
            <UPageCard title="Estado" variant="soft">
              <UFieldGroup>
                <UBadge
                  :color="ORDER_STATUS[order.status].color"
                  variant="subtle"
                  :label="ORDER_STATUS[order.status].label"
                />
              </UFieldGroup>
            </UPageCard>
            <UPageCard
              title="Fecha de entrega"
              :description="formatCalendarDay(order.deliveryDate)"
              variant="soft"
            />
            <UPageCard
              title="Tomado el"
              :description="formatInstantInLima(order.createdAt)"
              variant="soft"
            />
            <UPageCard
              v-if="order.failureReason"
              title="Motivo de no entrega"
              :description="order.failureReason"
              variant="soft"
            />
          </UPageGrid>
        </template>

        <UTable :data="order.items" :columns="itemColumns" caption="Productos del pedido">
          <template #product-cell="{ row }">
            {{ row.original.product.name }}
          </template>
          <template #unitPrice-cell="{ row }">
            {{ formatSoles(row.original.unitPrice) }}
          </template>
          <template #subtotal-cell="{ row }">
            {{ formatSoles(timesQuantity(row.original.unitPrice, row.original.quantity)) }}
          </template>
        </UTable>
      </UCard>

      <UAlert
        v-if="order?.status === 'PENDING' && confirming"
        color="warning"
        variant="subtle"
        title="¿Confirmas cancelar este pedido? No se puede deshacer."
      >
        <template #actions>
          <UFieldGroup>
            <UButton
              color="neutral"
              variant="outline"
              label="No"
              :disabled="cancelling"
              @click="confirming = false"
            />
            <UButton
              color="error"
              :disabled="cancelling"
              :label="cancelling ? 'Cancelando…' : 'Sí, cancelar'"
              @click="cancel"
            />
          </UFieldGroup>
        </template>
      </UAlert>
      <UAlert
        v-if="order?.status === 'PENDING' && slowCancel && cancelling"
        role="status"
        color="neutral"
        variant="subtle"
        :title="SLOW_REQUEST_MESSAGE"
      />
      <UButton
        v-if="order?.status === 'PENDING' && !confirming"
        color="neutral"
        variant="outline"
        icon="i-lucide-ban"
        label="Cancelar pedido"
        @click="confirming = true"
      />

      <UPageCard
        v-if="order?.status === 'FAILED' && !order.rescheduledTo && confirmingReschedule"
        title="Reprogramar pedido para:"
        variant="soft"
      >
        <UFormField label="Nueva fecha de entrega">
          <UInput v-model="rescheduleDeliveryDate" type="date" />
        </UFormField>
        <UAlert
          v-if="slowReschedule && rescheduling"
          role="status"
          color="neutral"
          variant="subtle"
          :title="SLOW_REQUEST_MESSAGE"
        />
        <template #footer>
          <UFieldGroup>
            <UButton
              color="neutral"
              variant="outline"
              label="Cancelar"
              :disabled="rescheduling"
              @click="confirmingReschedule = false"
            />
            <UButton
              color="primary"
              :disabled="rescheduling"
              :label="rescheduling ? 'Reprogramando…' : 'Confirmar reprogramación'"
              @click="rescheduleOrder"
            />
          </UFieldGroup>
        </template>
      </UPageCard>
      <UButton
        v-if="order?.status === 'FAILED' && !order.rescheduledTo && !confirmingReschedule"
        color="primary"
        variant="outline"
        icon="i-lucide-calendar-clock"
        label="Reprogramar pedido"
        @click="startReschedule"
      />
    </ResourceState>
  </AppPage>
</template>
