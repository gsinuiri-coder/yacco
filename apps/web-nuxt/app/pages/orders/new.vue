<script setup lang="ts">
import { limaToday } from "@yacco/shared";
import type { Customer, CustomerLocation, Order } from "@yacco/shared";
import type { OrderLineDraft } from "../../utils/order-lines";

useHead({ title: "Nuevo pedido · Yacco" });

const api = useApi();

const customer = ref<Customer | null>(null);
// El día de hoy en Lima, como "AAAA-MM-DD": el campo de fecha lo edita como texto.
const deliveryDate = ref(limaToday());

// Líneas cuando hay un solo local o aún no se eligió cliente (comportamiento habitual).
const lines = ref<OrderLineDraft[]>([blankOrderLine(0)]);
const lineErrors = ref<Array<string | undefined>>([]);

// Locales del cliente y líneas por local para clientes con múltiples sucursales.
const locations = ref<CustomerLocation[]>([]);
const loadingLocations = ref(false);
const locationsError = ref<string | null>(null);
const linesByLocation = ref<Record<string, OrderLineDraft[]>>({});
const errorsByLocation = ref<Record<string, Array<string | undefined>>>({});

const isMultiLocation = computed(() => locations.value.length > 1);

const customerError = ref<string | undefined>(undefined);
const submitting = ref(false);
const submitError = ref<string | null>(null);
const slow = useSlowRequest(submitting);
const idempotencyKey = ref(crypto.randomUUID());

let latestCustomer = 0;
watch(customer, async (newCustomer) => {
  customerError.value = undefined;
  if (submitError.value !== null) {
    submitError.value = null;
    idempotencyKey.value = crypto.randomUUID();
  }
  const current = ++latestCustomer;
  locations.value = [];
  locationsError.value = null;

  if (newCustomer === null) return;

  loadingLocations.value = true;
  try {
    const fetched = await api.request<CustomerLocation[]>(`/customers/${newCustomer.id}/locations`);
    if (current !== latestCustomer) return;
    locations.value = fetched;
    if (fetched.length > 1) {
      const nextLines: Record<string, OrderLineDraft[]> = {};
      const nextErrors: Record<string, Array<string | undefined>> = {};
      for (const loc of fetched) {
        nextLines[loc.id] = linesByLocation.value[loc.id] ?? [blankOrderLine(0)];
        nextErrors[loc.id] = errorsByLocation.value[loc.id] ?? [];
      }
      linesByLocation.value = nextLines;
      errorsByLocation.value = nextErrors;
    }
  } catch (error) {
    if (current === latestCustomer) {
      locationsError.value = describeApiFailure(error);
    }
  } finally {
    if (current === latestCustomer) {
      loadingLocations.value = false;
    }
  }
});

watch(deliveryDate, () => {
  if (submitError.value !== null) {
    submitError.value = null;
    idempotencyKey.value = crypto.randomUUID();
  }
});

function lineEdited(index: number): void {
  lineErrors.value = lineErrors.value.map((error, i) => (i === index ? undefined : error));
  if (submitError.value !== null) {
    submitError.value = null;
    idempotencyKey.value = crypto.randomUUID();
  }
}

function locationLineEdited(locationId: string, index: number): void {
  const current = errorsByLocation.value[locationId] || [];
  errorsByLocation.value[locationId] = current.map((error, i) => (i === index ? undefined : error));
  if (submitError.value !== null) {
    submitError.value = null;
    idempotencyKey.value = crypto.randomUUID();
  }
}

async function submit(): Promise<void> {
  // Un segundo submit que llega antes de que el botón se deshabilite.
  if (submitting.value) return;

  if (customer.value === null) {
    customerError.value = "Elige un cliente";
    lineErrors.value = lines.value.map(checkOrderLine);
    return;
  }

  if (locations.value.length === 0) {
    submitError.value = "El cliente no tiene locales activos";
    return;
  }

  let locationsPayload: Array<{
    locationId: string;
    items: Array<{ productId: string; quantity: number; unitPrice: string }>;
  }> = [];

  if (!isMultiLocation.value) {
    lineErrors.value = lines.value.map(checkOrderLine);
    if (lineErrors.value.some((error) => error !== undefined)) return;
    const loc = locations.value[0]!;
    locationsPayload = [
      {
        locationId: loc.id,
        items: lines.value.map(lineToBody),
      },
    ];
  } else {
    let anyError = false;
    const payload: typeof locationsPayload = [];

    for (const loc of locations.value) {
      const locLines = linesByLocation.value[loc.id] || [];
      const hasChosenProduct = locLines.some((l) => l.productId !== "");
      if (!hasChosenProduct) {
        // Un local sin productos no crea pedido
        errorsByLocation.value[loc.id] = [];
        continue;
      }
      const errors = locLines.map(checkOrderLine);
      errorsByLocation.value[loc.id] = errors;
      if (errors.some((e) => e !== undefined)) {
        anyError = true;
      } else {
        payload.push({
          locationId: loc.id,
          items: locLines.map(lineToBody),
        });
      }
    }

    if (anyError) return;

    if (payload.length === 0) {
      submitError.value = "Ingresa al menos un producto en uno de los locales";
      return;
    }
    locationsPayload = payload;
  }

  submitting.value = true;
  submitError.value = null;
  try {
    await api.request<Order[]>("/orders/batch", {
      method: "POST",
      body: {
        customerId: customer.value.id,
        deliveryDate: deliveryDate.value,
        idempotencyKey: idempotencyKey.value,
        locations: locationsPayload,
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
        <UAlert
          v-if="locationsError"
          role="alert"
          color="error"
          variant="subtle"
          :title="locationsError"
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

        <!-- Con un solo local o sin cliente seleccionado: como hoy -->
        <OrderLinesEditor
          v-if="!isMultiLocation"
          v-model="lines"
          :customer-id="customer?.id ?? null"
          :errors="lineErrors"
          :disabled="submitting || loadingLocations"
          @edited="lineEdited"
        />

        <!-- Con varios locales activos: editor por cada local -->
        <div v-else class="space-y-6">
          <SectionCard
            v-for="loc in locations"
            :key="loc.id"
            :title="loc.name"
            :description="loc.address || undefined"
          >
            <OrderLinesEditor
              v-model="linesByLocation[loc.id]"
              :customer-id="customer?.id ?? null"
              :location-id="loc.id"
              :label-prefix="loc.name"
              :errors="errorsByLocation[loc.id] || []"
              :disabled="submitting"
              @edited="(index) => locationLineEdited(loc.id, index)"
            />
          </SectionCard>
        </div>

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
