<script setup lang="ts">
import { isAboveZero, isMoneyInput } from "@yacco/shared";
import type { Product } from "@yacco/shared";

/**
 * El catálogo de productos y su precio de lista: el que paga un cliente que
 * no tiene un precio pactado. Los precios que trajo la instalación eran
 * provisionales; el administrador pone acá los de verdad. Solo el precio se
 * cambia: el nombre viaja copiado a cada pedido y venta.
 */
const PRICE_HELP =
  "El precio nuevo se cobra en lo que se entregue desde ahora, también en pedidos ya " +
  "tomados que todavía no se entregaron. Las ventas ya registradas conservan su precio, y " +
  "el precio pactado con un cliente sigue mandando.";
const PRICE_FORMAT_MESSAGE = "Escribe el precio en soles, con hasta dos decimales (ej. 8.50)";

useHead({ title: "Productos · Yacco" });

const TYPE_LABELS: Record<Product["type"], string> = {
  REFILL: "Recarga",
  CONTAINER_SALE: "Venta de bidón",
};

const session = useSession();
const api = useApi();
const isAdmin = computed(() => session.hasRole("ADMIN"));

const products = ref<Product[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);
const slow = useSlowRequest(loading);

async function loadProducts(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    products.value = await api.request<Product[]>("/products");
  } catch (error) {
    loadError.value = describeApiFailure(error);
  } finally {
    loading.value = false;
  }
}
onMounted(loadProducts);

const summary = computed(() =>
  loading.value
    ? "Cargando…"
    : `${products.value.length} ${products.value.length === 1 ? "producto" : "productos"}`,
);

// --- Cambiar el precio, por fila ---
const editingId = ref<string | null>(null);
const priceValue = ref("");
const saving = ref(false);
/** El id de la fila viaja con el mensaje: un error arriba no diría cuál falló. */
const rowError = ref<{ productId: string; message: string } | null>(null);

function startEdit(product: Product): void {
  editingId.value = product.id;
  priceValue.value = product.listPrice;
  rowError.value = null;
}

async function savePrice(id: string): Promise<void> {
  if (saving.value) return;
  const listPrice = priceValue.value.trim();
  if (!isMoneyInput(listPrice)) {
    rowError.value = { productId: id, message: PRICE_FORMAT_MESSAGE };
    return;
  }
  // Un 0 casi siempre es un error de tipeo, y dejaría gratis toda entrega sin
  // precio pactado.
  if (!isAboveZero(listPrice)) {
    rowError.value = { productId: id, message: "El precio de lista debe ser mayor que 0" };
    return;
  }
  saving.value = true;
  rowError.value = null;
  try {
    const updated = await api.request<Product>(`/products/${id}`, {
      method: "PATCH",
      body: { listPrice },
    });
    products.value = products.value.map((product) => (product.id === id ? updated : product));
    editingId.value = null;
  } catch (error) {
    rowError.value = { productId: id, message: describeApiFailure(error) };
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppPage title="Productos" :description="summary">
    <div class="space-y-6">
      <UAlert
        v-if="isAdmin"
        color="neutral"
        variant="subtle"
        icon="i-lucide-info"
        :title="PRICE_HELP"
      />

      <UAlert
        v-if="slow && loading"
        role="status"
        color="neutral"
        variant="subtle"
        :title="SLOW_REQUEST_MESSAGE"
      />

      <ListStatus
        v-if="loadError || loading || products.length === 0"
        :error-message="loadError"
        :loading="loading"
        :empty="products.length === 0"
        loading-label="Cargando productos…"
        empty-icon="i-lucide-droplets"
        empty-title="Todavía no hay productos"
        empty-description="El catálogo se carga con la instalación del sistema."
        @retry="loadProducts"
      />

      <UCard v-else :ui="{ body: 'p-0 sm:p-0' }">
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <caption class="sr-only">
              Productos y precios de lista
            </caption>
            <thead class="bg-elevated text-left text-xs tracking-wide text-muted uppercase">
              <tr>
                <th scope="col" class="px-4 py-2 font-medium">Producto</th>
                <th scope="col" class="px-4 py-2 font-medium">Tipo</th>
                <th scope="col" class="px-4 py-2 font-medium">Envase</th>
                <th scope="col" class="px-4 py-2 text-right font-medium">Precio de lista</th>
                <th v-if="isAdmin" scope="col" class="px-4 py-2">
                  <span class="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-default">
              <template v-for="product in products" :key="product.id">
                <tr>
                  <td class="px-4 py-3 font-medium text-highlighted">{{ product.name }}</td>
                  <td class="px-4 py-3">{{ TYPE_LABELS[product.type] }}</td>
                  <td class="px-4 py-3">{{ product.containerType.name }}</td>
                  <td class="px-4 py-3 text-right">
                    <UInput
                      v-if="editingId === product.id"
                      :model-value="priceValue"
                      :aria-label="`Precio de lista de ${product.name}`"
                      inputmode="decimal"
                      :disabled="saving"
                      class="w-28"
                      @update:model-value="(value: string | number) => (priceValue = String(value))"
                    />
                    <MoneyAmount v-else :value="product.listPrice" />
                  </td>
                  <td v-if="isAdmin" class="px-4 py-3">
                    <div v-if="editingId === product.id" class="flex justify-end gap-2">
                      <UButton
                        color="neutral"
                        variant="outline"
                        size="sm"
                        label="Cancelar"
                        :disabled="saving"
                        @click="editingId = null"
                      />
                      <UButton
                        size="sm"
                        :label="saving ? 'Guardando…' : 'Guardar'"
                        :disabled="saving"
                        @click="savePrice(product.id)"
                      />
                    </div>
                    <div v-else class="flex justify-end">
                      <UButton
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        label="Cambiar precio"
                        :disabled="saving"
                        @click="startEdit(product)"
                      />
                    </div>
                  </td>
                </tr>
                <tr v-if="rowError?.productId === product.id">
                  <td :colspan="isAdmin ? 5 : 4" class="px-4 pb-3">
                    <p role="alert" class="text-sm text-error">{{ rowError.message }}</p>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </UCard>
    </div>
  </AppPage>
</template>
