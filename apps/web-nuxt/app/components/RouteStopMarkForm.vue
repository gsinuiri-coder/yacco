<script setup lang="ts">
import { formatSoles } from "@yacco/shared";
import type {
  ContainerType,
  EffectivePrice,
  MarkRouteStopBody,
  Order,
  PaymentMethod,
  Product,
  RouteStop,
  User,
} from "@yacco/shared";
import type { TableColumn } from "@nuxt/ui";
import type {
  ReturnLineDraft,
  SaleLineDraft,
  StopMarkDraft,
  StopOutcome,
} from "../utils/stop-mark";

/** Registrar lo que pasó en una parada. Las reglas viven en utils/stop-mark.ts. */
const props = withDefaults(
  defineProps<{
    routeId: string;
    stop: RouteStop;
    /**
     * La oficina puede cobrar un precio distinto del pactado, diciendo quién
     * lo autorizó. El chofer en «Mi ruta» no: cobra el pactado, y un precio
     * distinto lo corrige la oficina (supuesto 12). Sin esto tampoco se pide
     * la lista de usuarios, que es de la oficina.
     */
    canChangePrice?: boolean;
    /** «Mi ruta» pide una sola lectura del GPS al confirmar; la oficina no. */
    captureLocation?: boolean;
    /**
     * Corregir una parada ya registrada (HU-24, solo ADMIN): pide un motivo,
     * anula lo anotado y lo vuelve a registrar con PATCH .../correction. Quien
     * corrige queda como autorizador de un precio distinto (supuesto 8), así
     * que no se pregunta.
     */
    correction?: boolean;
  }>(),
  { canChangePrice: true, captureLocation: false, correction: false },
);
const emit = defineEmits<{ cancel: []; marked: [result: RouteStop] }>();

const api = useApi();
const NOT_PAID = "none";
let nextKey = 1;

const products = useCatalog<Product>("/products");
const containerTypes = useCatalog<ContainerType>("/container-types");
const paymentMethods = useCatalog<PaymentMethod>("/payment-methods");
// Cualquier usuario activo pudo autorizar un precio distinto; sale de su endpoint.
const authorizers = props.canChangePrice ? useCatalog<User>("/users") : { items: ref<User[]>([]) };
// Los precios pactados del cliente: para mostrar qué se cobra y saber cuándo un
// precio escrito es de verdad distinto.
const effective = useCatalog<EffectivePrice>(
  `/customers/${props.stop.location.customer.id}/effective-prices`,
);

const draft = reactive<StopMarkDraft>({
  outcome: "DELIVERED",
  failureReason: "",
  items: [{ key: 0, productId: "", quantity: "1", unitPrice: "" }],
  returns: [],
  paymentMethodId: "",
  amount: "",
  authorizerId: "",
});

const correctionReason = ref("");
const validationError = ref<string | null>(null);
const submitError = ref<string | null>(null);
const submitting = ref(false);
type MarkedLocationBody = Pick<
  MarkRouteStopBody,
  "markedLatitude" | "markedLongitude" | "markedAccuracyM"
>;
let markedLocationRequest: Promise<MarkedLocationBody> | null = null;

function readMarkedLocation(): Promise<MarkedLocationBody> {
  if (!props.captureLocation || props.correction || !("geolocation" in navigator)) {
    return Promise.resolve({});
  }
  if (markedLocationRequest !== null) return markedLocationRequest;
  markedLocationRequest = new Promise((resolve) => {
    const unavailable = () => resolve({});
    try {
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          if (
            !Number.isFinite(coords.latitude) ||
            !Number.isFinite(coords.longitude) ||
            !Number.isFinite(coords.accuracy) ||
            coords.latitude < -90 ||
            coords.latitude > 90 ||
            coords.longitude < -180 ||
            coords.longitude > 180 ||
            coords.accuracy < 0 ||
            coords.accuracy > 99_999_999.99
          ) {
            unavailable();
            return;
          }
          resolve({
            markedLatitude: coords.latitude.toFixed(6),
            markedLongitude: coords.longitude.toFixed(6),
            markedAccuracyM: coords.accuracy.toFixed(2),
          });
        },
        unavailable,
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
      );
    } catch {
      unavailable();
    }
  });
  return markedLocationRequest;
}

watch(draft, () => {
  validationError.value = null;
});

// Una parada que sale de un pedido ya dice qué se pidió: se precarga para
// confirmar en vez de tipearlo de nuevo. Lo entregado no siempre es lo pedido,
// así que las cantidades se pueden corregir.
onMounted(async () => {
  if (props.stop.orderId === null) return;
  try {
    const order = await api.request<Order>(`/orders/${props.stop.orderId}`);
    if (order.items.length === 0) return;
    draft.items = order.items.map((item, index) => ({
      key: index,
      productId: item.productId,
      quantity: String(item.quantity),
      unitPrice: "",
    }));
    nextKey = order.items.length;
  } catch {
    // El pedido no se pudo leer: se registra a mano, como una autoventa.
  }
});

const OUTCOMES = [
  { value: "DELIVERED", label: "Se entregó" },
  { value: "FAILED", label: "No se pudo entregar" },
] as const satisfies ReadonlyArray<{ value: StopOutcome; label: string }>;

const productItems = computed(() =>
  products.items.value.map((product) => ({ label: product.name, value: product.id })),
);
const containerTypeItems = computed(() =>
  containerTypes.items.value.map((type) => ({ label: type.name, value: type.id })),
);
const paymentItems = computed(() => [
  { label: "No cobró nada (queda al fiado)", value: NOT_PAID },
  ...paymentMethods.items.value.map((method) => ({ label: method.name, value: method.id })),
]);
const authorizerItems = computed(() =>
  authorizers.items.value.map((user) => ({ label: user.name, value: user.id })),
);

const itemColumns = computed<TableColumn<SaleLineDraft>[]>(() => [
  { id: "product", header: "Producto" },
  { id: "quantity", header: "Cantidad" },
  { id: "price", header: props.canChangePrice ? "Precio cobrado" : "Precio pactado" },
  { id: "subtotal", header: "Subtotal", meta: RIGHT_ALIGNED },
  { id: "remove", header: hiddenHeader("Quitar"), meta: RIGHT_ALIGNED },
]);

const paymentModel = computed({
  get: () => (draft.paymentMethodId === "" ? NOT_PAID : draft.paymentMethodId),
  set: (value: string) => {
    draft.paymentMethodId = value === NOT_PAID ? "" : value;
  },
});

const hasOverride = computed(() =>
  draft.items.some((line) => isPriceOverride(line, effective.items.value)),
);
const total = computed(() => saleTotal(draft.items, effective.items.value));

function agreedOf(line: SaleLineDraft): string | null {
  return agreedPrice(effective.items.value, line.productId);
}

function subtotalOf(line: SaleLineDraft): string {
  const subtotal = saleLineSubtotal(line, agreedOf(line));
  return subtotal === null ? "—" : formatSoles(subtotal);
}

function addItem(): void {
  draft.items.push({ key: nextKey++, productId: "", quantity: "1", unitPrice: "" });
}

function addReturn(): void {
  draft.returns.push({
    key: nextKey++,
    containerTypeId: "",
    quantity: "1",
  } satisfies ReturnLineDraft);
}

async function submit(): Promise<void> {
  if (submitting.value) return;
  const body = buildMarkBody(draft, effective.items.value, { correction: props.correction });
  if (typeof body === "string") {
    validationError.value = body;
    return;
  }
  const reason = correctionReason.value.trim();
  if (props.correction && reason === "") {
    validationError.value = "Escribe el motivo de la corrección";
    return;
  }
  submitting.value = true;
  submitError.value = null;
  try {
    const markedLocation = await readMarkedLocation();
    const path = `/routes/${props.routeId}/stops/${props.stop.id}`;
    const result = await api.request<RouteStop>(props.correction ? `${path}/correction` : path, {
      method: "PATCH",
      body: props.correction
        ? { ...body, correctionReason: reason }
        : { ...body, ...markedLocation },
    });
    emit("marked", result);
  } catch (error) {
    // El 400/409 nombra el problema (stock del camión, parada ya resuelta).
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
    :aria-label="
      correction
        ? `Corregir la parada de ${stop.location.customer.name}`
        : `Registrar la parada de ${stop.location.customer.name}`
    "
    @submit="submit"
  >
    <SegmentedFilter
      v-model="draft.outcome"
      label="¿Qué pasó en esta parada?"
      :options="OUTCOMES"
    />

    <UAlert
      v-if="captureLocation && !correction"
      color="neutral"
      variant="subtle"
      icon="i-lucide-map-pin"
      title="Al registrar, el celular pedirá tu ubicación una vez. Si no está disponible, la parada se guarda igual."
    />

    <UFormField
      v-if="draft.outcome === 'FAILED'"
      label="¿Por qué no se pudo entregar?"
      help="Queda escrito en la parada; es lo que se revisa al liquidar la ruta."
    >
      <UInput
        v-model="draft.failureReason"
        placeholder="El local estaba cerrado"
        :disabled="submitting"
        class="w-full"
      />
    </UFormField>

    <template v-else>
      <UPageCard title="Lo que se entregó" variant="outline">
        <UTable
          :data="draft.items"
          :columns="itemColumns"
          caption="Productos entregados en la parada, con su cantidad y su precio"
        >
          <template #product-cell="{ row }">
            <USelect
              v-model="row.original.productId"
              :items="productItems"
              placeholder="Elige un producto"
              :aria-label="`Producto ${row.index + 1}`"
              :disabled="submitting"
              class="w-full"
            />
          </template>
          <template #quantity-cell="{ row }">
            <UInput
              v-model="row.original.quantity"
              type="number"
              :min="1"
              :step="1"
              :aria-label="`Cantidad del producto ${row.index + 1}`"
              :disabled="submitting"
            />
          </template>
          <template #price-cell="{ row }">
            <UFormField
              :help="
                agreedOf(row.original) !== null
                  ? `Pactado: ${formatSoles(agreedOf(row.original)!)}`
                  : undefined
              "
            >
              <UInput
                v-if="canChangePrice"
                v-model="row.original.unitPrice"
                inputmode="decimal"
                :placeholder="agreedOf(row.original) ?? 'Precio pactado'"
                :aria-label="`Precio cobrado del producto ${row.index + 1}`"
                :disabled="submitting"
              />
            </UFormField>
            <UBadge
              v-if="isPriceOverride(row.original, effective.items.value)"
              color="warning"
              variant="subtle"
              size="sm"
              label="Distinto del pactado"
            />
          </template>
          <template #subtotal-cell="{ row }">{{ subtotalOf(row.original) }}</template>
          <template #remove-cell="{ row }">
            <UButton
              color="neutral"
              variant="ghost"
              icon="i-lucide-x"
              :aria-label="`Quitar el producto ${row.index + 1}`"
              :disabled="submitting || draft.items.length <= 1"
              @click="draft.items.splice(row.index, 1)"
            />
          </template>
        </UTable>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-plus"
            label="Agregar producto"
            :disabled="submitting"
            @click="addItem"
          />
          <div aria-live="polite" class="flex flex-wrap items-center gap-2">
            <span>Total de la venta</span>
            <UBadge color="neutral" variant="subtle" size="xl" :label="formatSoles(total)" />
          </div>
        </div>
      </UPageCard>

      <UPageCard
        title="Envases vacíos que devolvió"
        description="Si devuelve tantos vacíos como llenos recibe, su saldo de envases no se mueve. Si devuelve menos, la diferencia le queda debida, salvo que se le venda el envase."
        variant="outline"
      >
        <div
          v-for="(row, index) in draft.returns"
          :key="row.key"
          class="flex flex-wrap items-end gap-2"
        >
          <UFormField :label="`Tipo de envase ${index + 1}`">
            <USelect
              v-model="row.containerTypeId"
              :items="containerTypeItems"
              placeholder="Elige un tipo de envase"
              :disabled="submitting"
            />
          </UFormField>
          <UInput
            v-model="row.quantity"
            type="number"
            :min="1"
            :step="1"
            :aria-label="`Vacíos devueltos ${index + 1}`"
            :disabled="submitting"
          />
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-x"
            :aria-label="`Quitar los vacíos devueltos ${index + 1}`"
            :disabled="submitting"
            @click="draft.returns.splice(index, 1)"
          />
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-plus"
            label="Agregar envases devueltos"
            :disabled="submitting"
            @click="addReturn"
          />
        </div>
      </UPageCard>

      <UPageCard title="Cobro" variant="outline">
        <UPageGrid>
          <UFormField label="Método de pago">
            <USelect
              v-model="paymentModel"
              :items="paymentItems"
              :disabled="submitting"
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="Monto cobrado"
            help="Puede ser menos que el total: la diferencia queda como deuda."
          >
            <UInput
              v-model="draft.amount"
              inputmode="decimal"
              :placeholder="total"
              :disabled="submitting"
              class="w-full"
            />
          </UFormField>
          <UFormField v-if="hasOverride && !correction" label="¿Quién autorizó el precio distinto?">
            <USelect
              v-model="draft.authorizerId"
              :items="authorizerItems"
              placeholder="Elige quién lo autorizó"
              :disabled="submitting"
              class="w-full"
            />
          </UFormField>
        </UPageGrid>
      </UPageCard>
    </template>

    <UFormField
      v-if="correction"
      label="Motivo de la corrección"
      help="Queda escrito en la parada. Lo anotado antes se anula con este motivo y sigue visible; no se borra."
    >
      <UInput
        v-model="correctionReason"
        placeholder="Se anotaron 3 bidones y fueron 2"
        :disabled="submitting"
        class="w-full"
      />
    </UFormField>

    <UAlert
      v-if="validationError"
      role="alert"
      color="error"
      variant="subtle"
      :title="validationError"
    />
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
        :disabled="submitting"
        :label="
          submitting
            ? correction
              ? 'Guardando…'
              : 'Registrando…'
            : correction
              ? 'Guardar la corrección'
              : 'Registrar la parada'
        "
      />
    </div>
  </UForm>
</template>
