<script setup lang="ts">
import {
  formatCalendarDay,
  formatInstantInLima,
  formatSoles,
  nextCalendarDay,
  timesQuantity,
} from "@yacco/shared";
import type { Order } from "@yacco/shared";

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

    <div class="max-w-4xl space-y-4">
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
          class="mb-4"
        >
          <template #description>
            <NuxtLink
              :to="`/orders/${order.rescheduledTo.id}`"
              class="font-medium text-primary hover:underline"
            >
              Ver nuevo pedido
            </NuxtLink>
          </template>
        </UAlert>

        <UAlert
          v-if="order && order.rescheduledFrom"
          role="status"
          color="info"
          variant="subtle"
          icon="i-lucide-calendar-arrow-down"
          :title="`Reprogramación del pedido del ${formatCalendarDay(order.rescheduledFrom.deliveryDate)}`"
          class="mb-4"
        >
          <template #description>
            <NuxtLink
              :to="`/orders/${order.rescheduledFrom.id}`"
              class="font-medium text-primary hover:underline"
            >
              Ver pedido original
            </NuxtLink>
          </template>
        </UAlert>

        <UAlert
          v-if="order && order.siblingOrders && order.siblingOrders.length > 0"
          role="status"
          color="info"
          variant="subtle"
          icon="i-lucide-store"
          :title="`Parte de un pedido de ${order.siblingOrders.length + 1} locales`"
          class="mb-4"
        >
          <template #description>
            <div class="mt-1 flex flex-wrap items-center gap-2 text-sm">
              <span>Otros locales:</span>
              <NuxtLink
                v-for="sibling in order.siblingOrders"
                :key="sibling.id"
                :to="`/orders/${sibling.id}`"
                class="font-medium text-primary hover:underline"
              >
                {{ sibling.locationName }}
              </NuxtLink>
            </div>
          </template>
        </UAlert>

        <UCard v-if="order" :ui="{ body: 'p-0 sm:p-0' }">
          <dl class="grid gap-5 p-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt class="text-muted">Cliente</dt>
              <dd class="font-medium text-highlighted">
                <NuxtLink :to="`/customers/${order.customer.id}`" class="hover:text-primary">{{
                  order.customer.name
                }}</NuxtLink>
              </dd>
              <dd class="text-muted">{{ order.customer.phone }}</dd>
            </div>
            <div v-if="order.location">
              <dt class="text-muted">Local</dt>
              <dd class="font-medium text-highlighted">{{ order.location.name }}</dd>
            </div>
            <div>
              <dt class="text-muted">Estado</dt>
              <dd>
                <UBadge
                  :color="ORDER_STATUS[order.status].color"
                  variant="subtle"
                  :label="ORDER_STATUS[order.status].label"
                />
              </dd>
            </div>
            <div>
              <dt class="text-muted">Fecha de entrega</dt>
              <dd class="font-medium text-highlighted tabular-nums">
                {{ formatCalendarDay(order.deliveryDate) }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">Tomado el</dt>
              <dd class="text-highlighted tabular-nums">
                {{ formatInstantInLima(order.createdAt) }}
              </dd>
            </div>
            <div v-if="order.failureReason">
              <dt class="text-muted">Motivo de no entrega</dt>
              <dd class="font-medium text-error">{{ order.failureReason }}</dd>
            </div>
          </dl>

          <table class="w-full border-t border-default text-sm">
            <caption class="sr-only">
              Productos del pedido
            </caption>
            <thead class="bg-elevated text-left text-xs tracking-wide text-muted uppercase">
              <tr>
                <th scope="col" class="px-5 py-2 font-medium">Producto</th>
                <th scope="col" class="px-5 py-2 text-right font-medium">Cantidad</th>
                <th scope="col" class="px-5 py-2 text-right font-medium">Precio unitario</th>
                <th scope="col" class="px-5 py-2 text-right font-medium">Subtotal</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-default">
              <tr v-for="item in order.items" :key="item.id">
                <td class="px-5 py-3 font-medium text-highlighted">{{ item.product.name }}</td>
                <td class="px-5 py-3 text-right tabular-nums">{{ item.quantity }}</td>
                <td class="px-5 py-3 text-right tabular-nums">{{ formatSoles(item.unitPrice) }}</td>
                <td class="px-5 py-3 text-right tabular-nums">
                  {{ formatSoles(timesQuantity(item.unitPrice, item.quantity)) }}
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr class="border-t border-default">
                <th scope="row" colspan="3" class="px-5 py-4 text-right font-medium text-muted">
                  Total
                </th>
                <td
                  class="px-5 py-4 text-right font-display text-xl font-semibold text-highlighted tabular-nums"
                >
                  {{ formatSoles(order.total) }}
                </td>
              </tr>
            </tfoot>
          </table>

          <div v-if="order.status === 'PENDING'" class="border-t border-default p-5">
            <div v-if="confirming" class="space-y-3">
              <p class="text-highlighted">¿Confirmas cancelar este pedido? No se puede deshacer.</p>
              <div class="flex gap-2">
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
              </div>
              <UAlert
                v-if="slowCancel && cancelling"
                role="status"
                color="neutral"
                variant="subtle"
                :title="SLOW_REQUEST_MESSAGE"
              />
            </div>
            <UButton
              v-else
              color="neutral"
              variant="outline"
              icon="i-lucide-ban"
              label="Cancelar pedido"
              @click="confirming = true"
            />
          </div>

          <div
            v-if="order.status === 'FAILED' && !order.rescheduledTo"
            class="border-t border-default p-5"
          >
            <div v-if="confirmingReschedule" class="space-y-3">
              <p class="text-highlighted">Reprogramar pedido para:</p>
              <div class="flex flex-wrap items-center gap-3">
                <UFormField label="Nueva fecha de entrega">
                  <UInput v-model="rescheduleDeliveryDate" type="date" />
                </UFormField>
              </div>
              <div class="flex gap-2">
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
              </div>
              <UAlert
                v-if="slowReschedule && rescheduling"
                role="status"
                color="neutral"
                variant="subtle"
                :title="SLOW_REQUEST_MESSAGE"
              />
            </div>
            <UButton
              v-else
              color="primary"
              variant="outline"
              icon="i-lucide-calendar-clock"
              label="Reprogramar pedido"
              @click="startReschedule"
            />
          </div>
        </UCard>
      </ResourceState>
    </div>
  </AppPage>
</template>
