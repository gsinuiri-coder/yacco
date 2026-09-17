<script setup lang="ts">
import { formatCalendarDay, formatSoles } from "@yacco/shared";
import type { Customer, CustomerLocation, Order, Page, RouteStop, StopOrigin } from "@yacco/shared";

/**
 * Agregar una parada por los dos caminos del dominio: un pedido tomado antes
 * (preventa) o un cliente al que se le vende en la calle (autoventa).
 *
 * Los pedidos se piden con status=PENDING&hasRouteStop=false, que es
 * exactamente lo que POST /routes/:id/stops acepta: el selector nunca ofrece
 * algo que va a fallar al hacer clic.
 */
const props = defineProps<{ routeId: string }>();
const emit = defineEmits<{ cancel: []; added: [] }>();

/** Tope de la API: un selector no pagina, así que si hay más se avisa en vez de recortar callado. */
const ORDERS_LIMIT = 100;
const api = useApi();

const source = ref<StopOrigin>("ORDER");
const SOURCES = [
  { value: "ORDER", label: "De un pedido ya tomado" },
  { value: "VAN_SALE", label: "Autoventa: un cliente sin pedido" },
] as const;

const orders = ref<Order[]>([]);
const ordersTotal = ref(0);
const loadingOrders = ref(true);
const ordersError = ref<string | null>(null);
const orderId = ref<string | undefined>(undefined);

onMounted(async () => {
  try {
    const page = await api.request<Page<Order>>("/orders", {
      query: { status: "PENDING", hasRouteStop: false, limit: ORDERS_LIMIT },
    });
    orders.value = page.data;
    ordersTotal.value = page.total;
  } catch (error) {
    ordersError.value = describeApiFailure(error);
  } finally {
    loadingOrders.value = false;
  }
});

const noPendingOrders = computed(
  () => !loadingOrders.value && ordersError.value === null && orders.value.length === 0,
);

/** Lo mínimo para reconocer el pedido en la lista: quién, cuándo, qué y cuánto. */
function describeOrder(order: Order): string {
  const items = order.items.map((item) => `${item.quantity}× ${item.product.name}`).join(", ");
  return `${order.customer.name} · entrega ${formatCalendarDay(order.deliveryDate)} · ${items} · ${formatSoles(order.total)}`;
}

const orderItems = computed(() =>
  orders.value.map((order) => ({ label: describeOrder(order), value: order.id })),
);
const orderPlaceholder = computed(() => {
  if (loadingOrders.value) return "Cargando pedidos…";
  return noPendingOrders.value ? "No hay pedidos pendientes sin asignar" : "Elige un pedido";
});

const customer = ref<Customer | null>(null);
const locations = ref<CustomerLocation[]>([]);
const locationId = ref<string | undefined>(undefined);

// Las ubicaciones del cliente, de su endpoint. Se preselecciona la primera:
// el caso normal es un solo clic.
watch(customer, async (next) => {
  locations.value = [];
  locationId.value = undefined;
  if (next === null) return;
  try {
    locations.value = await api.request<CustomerLocation[]>(`/customers/${next.id}/locations`);
    locationId.value = locations.value[0]?.id;
  } catch {
    locations.value = [];
  }
});

const locationItems = computed(() =>
  locations.value.map((location) => ({
    label: `${location.name} · ${location.address}`,
    value: location.id,
  })),
);

const validationError = ref<string | null>(null);
const submitError = ref<string | null>(null);
const submitting = ref(false);

watch([source, orderId, customer, locationId], () => {
  validationError.value = null;
});

async function submit(): Promise<void> {
  if (submitting.value) return;
  if (source.value === "ORDER" && orderId.value === undefined) {
    validationError.value = "Elige el pedido que va a entregar el chofer";
    return;
  }
  if (source.value === "VAN_SALE" && locationId.value === undefined) {
    validationError.value = "Elige el cliente y la dirección a la que va el chofer";
    return;
  }
  submitting.value = true;
  submitError.value = null;
  try {
    await api.request<RouteStop>(`/routes/${props.routeId}/stops`, {
      method: "POST",
      body:
        source.value === "ORDER"
          ? { origin: "ORDER", orderId: orderId.value }
          : { origin: "VAN_SALE", locationId: locationId.value },
    });
    emit("added");
  } catch (error) {
    // El 400 nombra el problema (pedido ya asignado, ubicación inexistente).
    submitError.value = describeApiFailure(error);
    submitting.value = false;
  }
}
</script>

<template>
  <form class="space-y-5" novalidate aria-label="Agregar parada" @submit.prevent="submit">
    <SegmentedFilter v-model="source" label="¿De dónde sale la parada?" :options="SOURCES" />

    <UFormField v-if="source === 'ORDER'" label="Pedido pendiente">
      <USelect
        v-model="orderId"
        :items="orderItems"
        :placeholder="orderPlaceholder"
        :disabled="submitting || loadingOrders || noPendingOrders"
        class="w-full"
      />
      <template #help>
        <p v-if="ordersError" class="text-error">
          No se pudieron cargar los pedidos pendientes: {{ ordersError }}
        </p>
        <p v-else-if="noPendingOrders">
          Todos los pedidos pendientes ya están en una ruta. Usa autoventa para agregar un cliente
          sin pedido.
        </p>
        <p v-else-if="ordersTotal > orders.length">
          Se muestran los {{ orders.length }} pedidos con entrega más próxima, de
          {{ ordersTotal }} pendientes sin asignar.
        </p>
      </template>
    </UFormField>

    <div v-else class="grid gap-4 sm:grid-cols-2">
      <CustomerPicker v-model="customer" label="Cliente" :disabled="submitting" />
      <UFormField label="Dirección de entrega">
        <USelect
          v-model="locationId"
          :items="locationItems"
          :placeholder="customer === null ? 'Elige un cliente primero' : 'Elige una dirección'"
          :disabled="submitting || customer === null || locations.length === 0"
          class="w-full"
        />
      </UFormField>
    </div>

    <UAlert
      v-if="validationError"
      role="alert"
      color="error"
      variant="subtle"
      :title="validationError"
    />
    <UAlert v-if="submitError" role="alert" color="error" variant="subtle" :title="submitError" />

    <div class="flex justify-end gap-3">
      <UButton
        color="neutral"
        variant="outline"
        label="Cancelar"
        :disabled="submitting"
        @click="emit('cancel')"
      />
      <UButton
        type="submit"
        :disabled="submitting"
        :label="submitting ? 'Agregando…' : 'Agregar parada'"
      />
    </div>
  </form>
</template>
