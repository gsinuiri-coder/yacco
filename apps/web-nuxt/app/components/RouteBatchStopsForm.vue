<script setup lang="ts">
import { formatCalendarDay, formatSoles } from "@yacco/shared";
import type { Order, Page, Route, RouteStop } from "@yacco/shared";

/**
 * «Agregar pedidos pendientes»: armar la hoja de una ruta planificada o en
 * curso de una vez, con los pedidos PENDIENTES sin parada cuya entrega es el
 * día de la ruta (y de su zona, si la ruta tiene una, con la opción de ver
 * todas).
 *
 * El lote va en el orden de la lista, que es el orden en que quedan las
 * paradas, y es todo o nada: si la API rechaza un pedido, su 400 lo nombra y
 * no se agrega ninguno. El formulario de a una (RouteStopAddForm) se queda
 * para la autoventa y para clientes sin pedido.
 */
const props = defineProps<{ route: Route }>();
const emit = defineEmits<{ cancel: []; added: [] }>();

/** Tope de la API, el mismo del lote: si hay más, se avisa en vez de recortar callado. */
const ORDERS_LIMIT = 100;
const api = useApi();

const allZones = ref(false);
const orders = ref<Order[]>([]);
const ordersTotal = ref(0);
const loading = ref(true);
const loadError = ref<string | null>(null);
const selected = ref<Set<string>>(new Set());

async function loadOrders(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  selected.value = new Set();
  try {
    const zoneId = allZones.value ? undefined : (props.route.zoneId ?? undefined);
    const page = await api.request<Page<Order>>("/orders", {
      query: {
        status: "PENDING",
        hasRouteStop: false,
        deliveryDateFrom: props.route.date,
        deliveryDateTo: props.route.date,
        zoneId,
        limit: ORDERS_LIMIT,
      },
    });
    orders.value = page.data;
    ordersTotal.value = page.total;
  } catch (error) {
    loadError.value = describeApiFailure(error);
  } finally {
    loading.value = false;
  }
}
onMounted(loadOrders);
watch(allZones, loadOrders);

function toggle(orderId: string, checked: boolean | "indeterminate"): void {
  const next = new Set(selected.value);
  if (checked === true) next.add(orderId);
  else next.delete(orderId);
  selected.value = next;
}

/** Quién, qué y cuánto: lo que la oficina mira para decidir si va en el camión. */
function describeOrder(order: Order): string {
  const items = order.items.map((item) => `${item.quantity}× ${item.product.name}`).join(", ");
  return `${order.customer.name} · ${items} · ${formatSoles(order.total)}`;
}

// Con el filtro de zona prendido, decir cuál: si no, «no hay» parece del día entero.
const zoneSuffix = computed(() =>
  props.route.zone && !allZones.value ? ` en la zona ${props.route.zone.name}` : "",
);
const intro = computed(() => {
  const zone = props.route.zone && !allZones.value ? ` de la zona ${props.route.zone.name}` : "";
  return `Pedidos pendientes sin parada con entrega el ${formatCalendarDay(props.route.date)}${zone}. Van a quedar en este orden.`;
});
const count = computed(() => selected.value.size);
const submitLabel = computed(
  () => `Agregar ${count.value} ${count.value === 1 ? "parada" : "paradas"}`,
);

const submitError = ref<string | null>(null);
const submitting = ref(false);

async function submit(): Promise<void> {
  if (submitting.value || count.value === 0) return;
  submitting.value = true;
  submitError.value = null;
  try {
    await api.request<RouteStop[]>(`/routes/${props.route.id}/stops/batch`, {
      method: "POST",
      body: {
        orderIds: orders.value.filter((order) => selected.value.has(order.id)).map((o) => o.id),
      },
    });
    emit("added");
  } catch (error) {
    // Todo o nada: el 400 nombra el pedido que no se pudo agregar.
    submitError.value = describeApiFailure(error);
    submitting.value = false;
  }
}
</script>

<template>
  <UForm
    :state="{}"
    :validate-on="[]"
    :loading-auto="false"
    novalidate
    aria-label="Agregar pedidos pendientes"
    @submit="submit"
  >
    <UAlert
      color="neutral"
      variant="subtle"
      :title="intro"
    />
    <UCheckbox
      v-if="route.zoneId"
      v-model="allZones"
      label="Ver pedidos de todas las zonas"
      :disabled="submitting"
    />

    <UAlert
      v-if="loading"
      role="status"
      color="neutral"
      variant="subtle"
      title="Cargando pedidos…"
    />
    <UAlert v-else-if="loadError" role="alert" color="error" variant="subtle" :title="loadError" />
    <UAlert
      v-else-if="orders.length === 0"
      color="neutral"
      variant="subtle"
      :title="`No hay pedidos pendientes sin parada para el ${formatCalendarDay(route.date)}${zoneSuffix}.`"
    />
    <template v-else>
      <UPageList as="ul">
        <UPageCard v-for="order in orders" :key="order.id" as="li" variant="outline">
          <UCheckbox
            :model-value="selected.has(order.id)"
            :label="describeOrder(order)"
            :disabled="submitting"
            @update:model-value="(checked) => toggle(order.id, checked)"
          />
        </UPageCard>
      </UPageList>
      <UAlert
        v-if="ordersTotal > orders.length"
        color="neutral"
        variant="subtle"
        :title="`Se muestran ${orders.length} de ${ordersTotal} pedidos: agrega estos y vuelve a abrir la lista para ver el resto.`"
      />
    </template>

    <UAlert v-if="submitError" role="alert" color="error" variant="subtle" :title="submitError" />

    <div class="flex justify-end gap-2">
      <UButton
        color="neutral"
        variant="outline"
        label="Cancelar"
        :disabled="submitting"
        @click="emit('cancel')"
      />
      <UButton
        type="submit"
        :disabled="submitting || count === 0"
        :label="submitting ? 'Agregando…' : submitLabel"
      />
    </div>
  </UForm>
</template>
