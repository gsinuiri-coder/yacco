<script setup lang="ts">
import { MAX_ITEM_QUANTITY, formatSoles } from "@yacco/shared";
import type { EffectivePrice, Product } from "@yacco/shared";
import type { TableColumn } from "@nuxt/ui";
import type { OrderLineDraft } from "../utils/order-lines";

/**
 * Las líneas del pedido: producto, cantidad, precio unitario y el total en
 * vivo. Trae su catálogo de productos y los precios efectivos del cliente
 * elegido, para prellenar con lo PACTADO y no con el de lista.
 *
 * Sin cliente no se elige producto: un precio prellenado que no es de nadie
 * es peor que un campo vacío.
 */
const props = withDefaults(
  defineProps<{
    customerId: string | null;
    locationId?: string | null;
    labelPrefix?: string;
    errors: Array<string | undefined>;
    disabled: boolean;
  }>(),
  {
    locationId: null,
    labelPrefix: "",
  },
);
const lines = defineModel<OrderLineDraft[]>({ default: () => [] });
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
  () => [props.customerId, props.locationId] as const,
  async ([customerId, locationId]) => {
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
      const query = locationId ? `?locationId=${locationId}` : "";
      fetched = await api.request<EffectivePrice[]>(
        `/customers/${customerId}/effective-prices${query}`,
      );
    } catch (error) {
      if (current === latestCustomer) pricesError.value = describeApiFailure(error);
    }
    if (current !== latestCustomer) return;
    effective.value = fetched;
    loadingPrices.value = false;
    lines.value = repriceLines(lines.value, products.value, fetched, pricesAvailable.value);
  },
  { immediate: true },
);

function productLabel(index: number): string {
  return props.labelPrefix
    ? `Producto ${index + 1} de ${props.labelPrefix}`
    : `Producto ${index + 1}`;
}

function quantityLabel(index: number): string {
  return props.labelPrefix
    ? `Cantidad del producto ${index + 1} de ${props.labelPrefix}`
    : `Cantidad del producto ${index + 1}`;
}

function unitPriceLabel(index: number): string {
  return props.labelPrefix
    ? `Precio unitario del producto ${index + 1} de ${props.labelPrefix}`
    : `Precio unitario del producto ${index + 1}`;
}

function removeLabel(index: number): string {
  return props.labelPrefix
    ? `Quitar producto ${index + 1} de ${props.labelPrefix}`
    : `Quitar producto ${index + 1}`;
}

const productItems = computed(() =>
  products.value.map((product) => ({ label: product.name, value: product.id })),
);

const columns: TableColumn<OrderLineDraft>[] = [
  { accessorKey: "productId", header: "Producto" },
  { accessorKey: "quantity", header: "Cantidad" },
  { accessorKey: "unitPrice", header: "Precio unitario" },
  { id: "subtotal", header: "Subtotal" },
  { id: "actions", header: "" },
];

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

  <UCard v-else variant="soft">
    <UPageGrid>
      <UAlert
        v-if="customerId === null"
        role="status"
        color="neutral"
        variant="subtle"
        title="Elige un cliente para ver sus precios."
      />
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
      <template v-for="(error, index) in errors" :key="lines[index]?.key ?? index">
        <UAlert
          v-if="error !== undefined"
          role="alert"
          color="error"
          variant="subtle"
          :title="`Producto ${index + 1}: ${error}`"
        />
      </template>
    </UPageGrid>

    <UTable :data="lines" :columns="columns" caption="Productos del pedido">
      <template #productId-cell="{ row }">
        <USelect
          :model-value="row.original.productId === '' ? undefined : row.original.productId"
          :items="productItems"
          :placeholder="productPlaceholder"
          :aria-label="productLabel(row.index)"
          :disabled="disabled || loadingProducts || customerId === null"
          @update:model-value="(value: string) => chooseProduct(row.index, value)"
        />
      </template>
      <template #quantity-cell="{ row }">
        <UInput
          :model-value="row.original.quantity"
          type="number"
          :min="1"
          :max="MAX_ITEM_QUANTITY"
          :step="1"
          :aria-label="quantityLabel(row.index)"
          :disabled="disabled"
          @update:model-value="
            (value: string | number) => update(row.index, { quantity: String(value) })
          "
        />
      </template>
      <template #unitPrice-cell="{ row }">
        <UFieldGroup>
          <UInput
            :model-value="row.original.unitPrice"
            inputmode="decimal"
            placeholder="12.50"
            :aria-label="unitPriceLabel(row.index)"
            :disabled="disabled"
            @update:model-value="
              (value: string | number) =>
                update(row.index, { unitPrice: String(value), priceOrigin: null })
            "
          />
          <UBadge
            v-if="row.original.priceOrigin !== null && row.original.priceOrigin !== 'LIST'"
            color="info"
            variant="subtle"
            size="sm"
            label="Pactado"
          />
        </UFieldGroup>
      </template>
      <template #subtotal-cell="{ row }">
        {{ lineSubtotal(row.original) === null ? "—" : formatSoles(lineSubtotal(row.original)!) }}
      </template>
      <template #actions-cell="{ row }">
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-x"
          :aria-label="removeLabel(row.index)"
          :disabled="disabled || lines.length <= 1"
          @click="removeLine(row.index)"
        />
      </template>
    </UTable>

    <template #footer>
      <UFieldGroup>
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-plus"
          label="Agregar producto"
          :disabled="disabled"
          @click="addLine"
        />
        <UBadge color="neutral" variant="soft" label="Total" />
        <UBadge color="primary" variant="subtle" :label="formatSoles(total)" />
      </UFieldGroup>
    </template>
  </UCard>
</template>
