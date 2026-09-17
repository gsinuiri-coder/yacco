<script setup lang="ts">
import { formatCalendarDay, formatInstantInLima, formatSoles, timesQuantity } from "@yacco/shared";
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
        </UCard>
      </ResourceState>
    </div>
  </AppPage>
</template>
