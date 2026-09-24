<script setup lang="ts">
import { MAX_ITEM_QUANTITY, formatSoles } from "@yacco/shared";
import type { EffectivePrice, Product } from "@yacco/shared";
import type { OrderLineDraft } from "../utils/order-lines";

/**
 * Las líneas del pedido: producto, cantidad, precio unitario y el total en
 * vivo. Trae su catálogo de productos y los precios efectivos del cliente
 * elegido, para prellenar con lo PACTADO y no con el de lista.
 *
 * Sin cliente no se elige producto: un precio prellenado que no es de nadie
 * es peor que un campo vacío.
 */
const props = defineProps<{
  customerId: string | null;
  errors: Array<string | undefined>;
  disabled: boolean;
}>();
const lines = defineModel<OrderLineDraft[]>({ required: true });
const emit = defineEmits<{ edited: [index: number] }>();

const api = useApi();
let nextKey = lines.value.length;

const products = ref<Product[]>([]);
const loadingProducts = ref(true);
const productsError = ref<string | null>(null);

async function loadProducts(): Promise<void> {
  loadingProducts.value = true;
  productsError.value = null;
  try {
    products.value = await api.request<Product[]>("/products");
  } catch (error) {
    productsError.value = describeApiFailure(error);
  } finally {
    loadingProducts.value = false;
  }
}
onMounted(loadProducts);

const effective = ref<EffectivePrice[]>([]);
const loadingPrices = ref(false);
const pricesError = ref<string | null>(null);
const slowPrices = useSlowRequest(loadingPrices);
const pricesAvailable = computed(() => props.customerId !== null && pricesError.value === null);
let latestCustomer = 0;

// Sólo un cambio de cliente vuelve a pedir precios; editar una línea no.
watch(
  () => props.customerId,
  async (customerId) => {
    const current = ++latestCustomer;
    effective.value = [];
    pricesError.value = null;
    if (customerId === null) {
      loadingPrices.value = false;
      return;
    }
    loadingPrices.value = true;
    let fetched: EffectivePrice[] = [];
    try {
      fetched = await api.request<EffectivePrice[]>(`/customers/${customerId}/effective-prices`);
    } catch (error) {
      if (current === latestCustomer) pricesError.value = describeApiFailure(error);
    }
    if (current !== latestCustomer) return;
    effective.value = fetched;
    loadingPrices.value = false;
    lines.value = repriceLines(lines.value, products.value, fetched, pricesAvailable.value);
  },
);

const productItems = computed(() =>
  products.value.map((product) => ({ label: product.name, value: product.id })),
);

function update(index: number, patch: Partial<OrderLineDraft>): void {
  lines.value = lines.value.map((line, i) => (i === index ? { ...line, ...patch } : line));
  emit("edited", index);
}

function chooseProduct(index: number, productId: string): void {
  update(index, {
    productId,
    ...prefillPrice(productId, products.value, effective.value, pricesAvailable.value),
  });
}

function addLine(): void {
  lines.value = [...lines.value, blankOrderLine(nextKey++)];
}

function removeLine(index: number): void {
  lines.value = lines.value.filter((_, i) => i !== index);
}

const total = computed(() => linesTotal(lines.value));
const productPlaceholder = computed(() => {
  if (props.customerId === null) return "Elige un cliente primero";
  return loadingProducts.value ? "Cargando…" : "Selecciona un producto";
});
</script>

<template>
  <div class="space-y-3">
    <ListStatus
      v-if="productsError"
      :error-message="productsError"
      :loading="false"
      :empty="false"
      loading-label=""
      error-title="No se pudo cargar el catálogo de productos"
      empty-title=""
      empty-description=""
      @retry="loadProducts"
    />

    <template v-else>
      <p v-if="customerId === null" class="text-sm text-muted">
        Elige un cliente para ver sus precios.
      </p>
      <UAlert
        v-if="pricesError"
        role="status"
        color="warning"
        variant="subtle"
        :title="`No se pudieron cargar los precios pactados: se usa el precio de lista. ${pricesError}`"
      />
      <UAlert
        v-if="slowPrices && loadingPrices"
        role="status"
        color="neutral"
        variant="subtle"
        :title="SLOW_REQUEST_MESSAGE"
      />

      <div class="overflow-x-auto rounded-md border border-default">
        <table class="w-full text-sm">
          <caption class="sr-only">
            Productos del pedido
          </caption>
          <thead class="bg-elevated text-left text-xs tracking-wide text-muted uppercase">
            <tr>
              <th scope="col" class="px-3 py-2 font-medium">Producto</th>
              <th scope="col" class="w-28 px-3 py-2 font-medium">Cantidad</th>
              <th scope="col" class="w-44 px-3 py-2 font-medium">Precio unitario</th>
              <th scope="col" class="w-32 px-3 py-2 text-right font-medium">Subtotal</th>
              <th scope="col" class="w-12 px-3 py-2"><span class="sr-only">Quitar</span></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr v-for="(line, index) in lines" :key="line.key">
              <td class="px-3 py-2">
                <USelect
                  :content="NON_BLOCKING_SELECT"
                  :model-value="line.productId === '' ? undefined : line.productId"
                  :items="productItems"
                  :placeholder="productPlaceholder"
                  :aria-label="`Producto ${index + 1}`"
                  :disabled="disabled || loadingProducts || customerId === null"
                  class="w-full"
                  @update:model-value="(value: string) => chooseProduct(index, value)"
                />
              </td>
              <td class="px-3 py-2">
                <UInput
                  :model-value="line.quantity"
                  type="number"
                  :min="1"
                  :max="MAX_ITEM_QUANTITY"
                  :step="1"
                  :aria-label="`Cantidad del producto ${index + 1}`"
                  :disabled="disabled"
                  @update:model-value="
                    (value: string | number) => update(index, { quantity: String(value) })
                  "
                />
              </td>
              <td class="px-3 py-2">
                <div class="flex items-center gap-2">
                  <UInput
                    :model-value="line.unitPrice"
                    inputmode="decimal"
                    placeholder="12.50"
                    :aria-label="`Precio unitario del producto ${index + 1}`"
                    :disabled="disabled"
                    class="w-28"
                    @update:model-value="
                      (value: string | number) =>
                        update(index, { unitPrice: String(value), priceOrigin: null })
                    "
                  />
                  <UBadge
                    v-if="line.priceOrigin !== null && line.priceOrigin !== 'LIST'"
                    color="info"
                    variant="subtle"
                    size="sm"
                    label="Pactado"
                  />
                </div>
              </td>
              <td class="px-3 py-2 text-right tabular-nums">
                {{ lineSubtotal(line) === null ? "—" : formatSoles(lineSubtotal(line)!) }}
              </td>
              <td class="px-3 py-2 text-right">
                <UButton
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-x"
                  :aria-label="`Quitar producto ${index + 1}`"
                  :disabled="disabled || lines.length <= 1"
                  @click="removeLine(index)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <ul v-if="errors.some((error) => error !== undefined)" class="space-y-1 text-sm text-error">
        <template v-for="(line, index) in lines" :key="line.key">
          <li v-if="errors[index]">Producto {{ index + 1 }}: {{ errors[index] }}</li>
        </template>
      </ul>

      <div class="flex items-center justify-between gap-4">
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-plus"
          label="Agregar producto"
          :disabled="disabled"
          @click="addLine"
        />
        <p class="text-right">
          <span class="text-sm text-muted">Total</span>
          <span class="ml-3 font-display text-2xl font-semibold text-highlighted tabular-nums">{{
            formatSoles(total)
          }}</span>
        </p>
      </div>
    </template>
  </div>
</template>
