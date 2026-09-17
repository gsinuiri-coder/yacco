<script setup lang="ts">
import { limaToday } from "@yacco/shared";
import type { Customer, Order } from "@yacco/shared";
import type { OrderLineDraft } from "../../utils/order-lines";

useHead({ title: "Nuevo pedido · Yacco" });

const api = useApi();

const customer = ref<Customer | null>(null);
// El día de hoy en Lima, como "AAAA-MM-DD": el campo de fecha lo edita como texto.
const deliveryDate = ref(limaToday());
const lines = ref<OrderLineDraft[]>([blankOrderLine(0)]);

const customerError = ref<string | undefined>(undefined);
const lineErrors = ref<Array<string | undefined>>([]);
const submitting = ref(false);
const submitError = ref<string | null>(null);
const slow = useSlowRequest(submitting);

// Corregir un campo borra SU error: revalidar todo marcaría líneas a medio
// escribir.
watch(customer, () => {
  customerError.value = undefined;
});
function lineEdited(index: number): void {
  lineErrors.value = lineErrors.value.map((error, i) => (i === index ? undefined : error));
}

async function submit(): Promise<void> {
  // Un segundo submit que llega antes de que el botón se deshabilite.
  if (submitting.value) return;
  customerError.value = customer.value === null ? "Elige un cliente" : undefined;
  lineErrors.value = lines.value.map(checkOrderLine);
  if (customer.value === null || lineErrors.value.some((error) => error !== undefined)) return;

  submitting.value = true;
  submitError.value = null;
  try {
    await api.request<Order>("/orders", {
      method: "POST",
      body: {
        customerId: customer.value.id,
        deliveryDate: deliveryDate.value,
        items: lines.value.map(lineToBody),
      },
    });
    await navigateTo("/orders");
  } catch (error) {
    // El 400 nombra el cliente o el producto concreto: tal cual.
    submitError.value = describeApiFailure(error);
    submitting.value = false;
  }
}
</script>

<template>
  <AppPage title="Nuevo pedido" description="Se registra como pendiente.">
    <template #actions>
      <UButton
        to="/orders"
        color="neutral"
        variant="ghost"
        icon="i-lucide-arrow-left"
        label="Pedidos"
      />
    </template>

    <UCard class="max-w-5xl">
      <form class="space-y-6" novalidate @submit.prevent="submit">
        <UAlert
          v-if="submitError"
          role="alert"
          color="error"
          variant="subtle"
          :title="submitError"
        />

        <div class="grid gap-5 sm:grid-cols-[minmax(0,1fr)_14rem]">
          <CustomerPicker
            v-model="customer"
            label="Cliente"
            :error="customerError"
            :disabled="submitting"
          />
          <UFormField label="Fecha de entrega" name="deliveryDate">
            <UInput v-model="deliveryDate" type="date" :disabled="submitting" class="w-full" />
          </UFormField>
        </div>

        <OrderLinesEditor
          v-model="lines"
          :customer-id="customer?.id ?? null"
          :errors="lineErrors"
          :disabled="submitting"
          @edited="lineEdited"
        />

        <UAlert
          v-if="slow && submitting"
          role="status"
          color="neutral"
          variant="subtle"
          :title="SLOW_REQUEST_MESSAGE"
        />

        <div class="flex justify-end gap-3 border-t border-default pt-5">
          <UButton
            color="neutral"
            variant="outline"
            label="Cancelar"
            :disabled="submitting"
            @click="navigateTo('/orders')"
          />
          <UButton
            type="submit"
            :disabled="submitting"
            :label="submitting ? 'Guardando…' : 'Registrar pedido'"
          />
        </div>
      </form>
    </UCard>
  </AppPage>
</template>
