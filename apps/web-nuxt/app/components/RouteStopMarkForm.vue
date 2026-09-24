<script setup lang="ts">
import { formatSoles } from "@yacco/shared";
import type {
  ContainerType,
  EffectivePrice,
  Order,
  PaymentMethod,
  Product,
  RouteStop,
  User,
} from "@yacco/shared";
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
  }>(),
  { canChangePrice: true },
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

const validationError = ref<string | null>(null);
const submitError = ref<string | null>(null);
const submitting = ref(false);

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
  const body = buildMarkBody(draft, effective.items.value);
  if (typeof body === "string") {
    validationError.value = body;
    return;
  }
  submitting.value = true;
  submitError.value = null;
  try {
    const result = await api.request<RouteStop>(`/routes/${props.routeId}/stops/${props.stop.id}`, {
      method: "PATCH",
      body,
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
  <form
    class="space-y-6"
    novalidate
    :aria-label="`Registrar la parada de ${stop.location.customer.name}`"
    @submit.prevent="submit"
  >
    <SegmentedFilter
      v-model="draft.outcome"
      label="¿Qué pasó en esta parada?"
      :options="OUTCOMES"
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
      <section class="space-y-3">
        <h4 class="font-medium text-highlighted">Lo que se entregó</h4>
        <div class="overflow-x-auto rounded-md border border-default">
          <table class="w-full text-sm">
            <caption class="sr-only">
              Productos entregados en la parada, con su cantidad y su precio
            </caption>
            <thead class="bg-elevated text-left text-xs tracking-wide text-muted uppercase">
              <tr>
                <th scope="col" class="px-3 py-2 font-medium">Producto</th>
                <th scope="col" class="w-24 px-3 py-2 font-medium">Cantidad</th>
                <th scope="col" class="w-52 px-3 py-2 font-medium">
                  {{ canChangePrice ? "Precio cobrado" : "Precio pactado" }}
                </th>
                <th scope="col" class="w-28 px-3 py-2 text-right font-medium">Subtotal</th>
                <th scope="col" class="w-12 px-3 py-2"><span class="sr-only">Quitar</span></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-default">
              <tr v-for="(line, index) in draft.items" :key="line.key">
                <td class="px-3 py-2">
                  <USelect
                    v-model="line.productId"
                    :items="productItems"
                    placeholder="Elige un producto"
                    :aria-label="`Producto ${index + 1}`"
                    :disabled="submitting"
                    class="w-full"
                  />
                </td>
                <td class="px-3 py-2">
                  <UInput
                    v-model="line.quantity"
                    type="number"
                    :min="1"
                    :step="1"
                    :aria-label="`Cantidad del producto ${index + 1}`"
                    :disabled="submitting"
                  />
                </td>
                <td class="px-3 py-2">
                  <UInput
                    v-if="canChangePrice"
                    v-model="line.unitPrice"
                    inputmode="decimal"
                    :placeholder="agreedOf(line) ?? 'Precio pactado'"
                    :aria-label="`Precio cobrado del producto ${index + 1}`"
                    :disabled="submitting"
                    class="w-28"
                  />
                  <p v-if="agreedOf(line) !== null" class="mt-1 text-xs text-muted">
                    Pactado: {{ formatSoles(agreedOf(line)!) }}
                  </p>
                  <UBadge
                    v-if="isPriceOverride(line, effective.items.value)"
                    color="warning"
                    variant="subtle"
                    size="sm"
                    label="Distinto del pactado"
                    class="mt-1"
                  />
                </td>
                <td class="px-3 py-2 text-right tabular-nums">{{ subtotalOf(line) }}</td>
                <td class="px-3 py-2 text-right">
                  <UButton
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-x"
                    :aria-label="`Quitar el producto ${index + 1}`"
                    :disabled="submitting || draft.items.length <= 1"
                    @click="draft.items.splice(index, 1)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="flex items-center justify-between gap-4">
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-plus"
            label="Agregar producto"
            :disabled="submitting"
            @click="addItem"
          />
          <p aria-live="polite">
            <span class="text-sm text-muted">Total de la venta</span>
            <span class="ml-3 text-lg font-semibold text-highlighted tabular-nums">{{
              formatSoles(total)
            }}</span>
          </p>
        </div>
      </section>

      <section class="space-y-3">
        <h4 class="font-medium text-highlighted">Envases vacíos que devolvió</h4>
        <p class="text-sm text-muted">
          Si devuelve tantos vacíos como llenos recibe, su saldo de envases no se mueve. Si devuelve
          menos, la diferencia le queda debida, salvo que se le venda el envase.
        </p>
        <div
          v-for="(row, index) in draft.returns"
          :key="row.key"
          class="flex flex-wrap items-end gap-3"
        >
          <UFormField :label="`Tipo de envase ${index + 1}`" class="min-w-52">
            <USelect
              v-model="row.containerTypeId"
              :items="containerTypeItems"
              placeholder="Elige un tipo de envase"
              :disabled="submitting"
              class="w-full"
            />
          </UFormField>
          <UInput
            v-model="row.quantity"
            type="number"
            :min="1"
            :step="1"
            :aria-label="`Vacíos devueltos ${index + 1}`"
            :disabled="submitting"
            class="w-24"
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
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-plus"
          label="Agregar envases devueltos"
          :disabled="submitting"
          @click="addReturn"
        />
      </section>

      <section class="space-y-3">
        <h4 class="font-medium text-highlighted">Cobro</h4>
        <div class="grid gap-4 sm:grid-cols-2">
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
        </div>
        <UFormField v-if="hasOverride" label="¿Quién autorizó el precio distinto?">
          <USelect
            v-model="draft.authorizerId"
            :items="authorizerItems"
            placeholder="Elige quién lo autorizó"
            :disabled="submitting"
            class="w-full sm:w-1/2"
          />
        </UFormField>
      </section>
    </template>

    <UAlert
      v-if="validationError"
      role="alert"
      color="error"
      variant="subtle"
      :title="validationError"
    />
    <UAlert v-if="submitError" role="alert" color="error" variant="subtle" :title="submitError" />

    <div class="flex justify-end gap-3 border-t border-default pt-4">
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
        :label="submitting ? 'Registrando…' : 'Registrar la parada'"
      />
    </div>
  </form>
</template>
