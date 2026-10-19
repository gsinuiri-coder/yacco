<script setup lang="ts">
import { formatInstantInLima, formatSoles, isAboveZero, isMoneyInput } from "@yacco/shared";
import type { ContainerType, Product, ProductPriceChange } from "@yacco/shared";
import type { TableColumn } from "@nuxt/ui";

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
  ACCESSORY: "Accesorio",
  MAQUILA_SERVICE: "Servicio de maquila",
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

const containerTypes = ref<ContainerType[]>([]);
async function loadContainerTypes(): Promise<void> {
  try {
    containerTypes.value = await api.request<ContainerType[]>("/container-types");
  } catch {
    // Silently continue
  }
}

onMounted(() => {
  void loadProducts();
  void loadContainerTypes();
});

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
const historyProductId = ref<string | null>(null);
const priceChanges = ref<ProductPriceChange[]>([]);
const loadingPriceChanges = ref(false);

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

async function togglePriceChanges(productId: string): Promise<void> {
  if (historyProductId.value === productId) {
    historyProductId.value = null;
    priceChanges.value = [];
    return;
  }
  historyProductId.value = productId;
  priceChanges.value = [];
  loadingPriceChanges.value = true;
  rowError.value = null;
  try {
    priceChanges.value = await api.request<ProductPriceChange[]>(
      `/products/${productId}/price-changes`,
    );
  } catch (error) {
    historyProductId.value = null;
    rowError.value = { productId, message: describeApiFailure(error) };
  } finally {
    loadingPriceChanges.value = false;
  }
}

// --- Alta de accesorio ---
const newAccessoryOpen = ref(false);
const newAccessoryName = ref("");
const newAccessoryPrice = ref("");
const creatingAccessory = ref(false);
const newAccessoryError = ref<string | null>(null);

function openNewAccessoryModal(): void {
  newAccessoryName.value = "";
  newAccessoryPrice.value = "";
  newAccessoryError.value = null;
  newAccessoryOpen.value = true;
}

async function createAccessory(): Promise<void> {
  if (creatingAccessory.value) return;
  const name = newAccessoryName.value.trim();
  if (!name) {
    newAccessoryError.value = "El nombre no puede estar vacío";
    return;
  }
  const listPrice = newAccessoryPrice.value.trim();
  if (!isMoneyInput(listPrice)) {
    newAccessoryError.value = PRICE_FORMAT_MESSAGE;
    return;
  }
  if (!isAboveZero(listPrice)) {
    newAccessoryError.value = "El precio de lista debe ser mayor que 0";
    return;
  }
  creatingAccessory.value = true;
  newAccessoryError.value = null;
  try {
    await api.request<Product>("/products", {
      method: "POST",
      body: { name, type: "ACCESSORY", listPrice },
    });
    newAccessoryOpen.value = false;
    await loadProducts();
  } catch (error) {
    newAccessoryError.value = describeApiFailure(error);
  } finally {
    creatingAccessory.value = false;
  }
}

// --- Alta de servicio de maquila ---
const newMaquilaOpen = ref(false);
const newMaquilaName = ref("");
const newMaquilaContainerTypeId = ref("");
const newMaquilaPrice = ref("");
const creatingMaquila = ref(false);
const newMaquilaError = ref<string | null>(null);

function openNewMaquilaModal(): void {
  newMaquilaName.value = "";
  newMaquilaContainerTypeId.value = containerTypes.value[0]?.id ?? "";
  newMaquilaPrice.value = "";
  newMaquilaError.value = null;
  newMaquilaOpen.value = true;
}

async function createMaquilaService(): Promise<void> {
  if (creatingMaquila.value) return;
  const name = newMaquilaName.value.trim();
  if (!name) {
    newMaquilaError.value = "El nombre no puede estar vacío";
    return;
  }
  if (!newMaquilaContainerTypeId.value) {
    newMaquilaError.value = "Debes seleccionar un tipo de envase";
    return;
  }
  const listPrice = newMaquilaPrice.value.trim();
  if (!isMoneyInput(listPrice)) {
    newMaquilaError.value = PRICE_FORMAT_MESSAGE;
    return;
  }
  if (!isAboveZero(listPrice)) {
    newMaquilaError.value = "El precio de lista debe ser mayor que 0";
    return;
  }
  creatingMaquila.value = true;
  newMaquilaError.value = null;
  try {
    await api.request<Product>("/products", {
      method: "POST",
      body: {
        name,
        type: "MAQUILA_SERVICE",
        containerTypeId: newMaquilaContainerTypeId.value,
        listPrice,
      },
    });
    newMaquilaOpen.value = false;
    await loadProducts();
  } catch (error) {
    newMaquilaError.value = describeApiFailure(error);
  } finally {
    creatingMaquila.value = false;
  }
}

const columns = computed<TableColumn<Product>[]>(() => [
  { accessorKey: "name", header: "Producto" },
  { id: "type", header: "Tipo" },
  { id: "containerType", header: "Envase" },
  { id: "listPrice", header: "Precio de lista", meta: RIGHT_ALIGNED },
  ...(isAdmin.value
    ? [{ id: "actions", header: hiddenHeader("Acciones"), meta: RIGHT_ALIGNED }]
    : []),
]);
// El historial de precios y el error de una acción se abren debajo de su fila.
const expandedProductIds = computed<Record<string, boolean>>(() => {
  const ids = [historyProductId.value, rowError.value?.productId].filter(
    (id): id is string => typeof id === "string",
  );
  return Object.fromEntries(ids.map((id) => [id, true]));
});
</script>

<template>
  <AppPage title="Productos" :description="summary">
    <template v-if="isAdmin" #actions>
      <UButton icon="i-lucide-plus" label="Nuevo accesorio" @click="openNewAccessoryModal" />
      <UButton
        icon="i-lucide-plus"
        label="Nuevo servicio de maquila"
        @click="openNewMaquilaModal"
      />
    </template>
    <UPageBody>
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

      <UCard v-else>
        <UTable
          :data="products"
          :columns="columns"
          :get-row-id="(product: Product) => product.id"
          :expanded="expandedProductIds"
          caption="Productos y precios de lista"
        >
          <template #type-cell="{ row }">{{ TYPE_LABELS[row.original.type] }}</template>
          <template #containerType-cell="{ row }">
            {{ row.original.containerType?.name ?? "—" }}
          </template>
          <template #listPrice-cell="{ row }">
            <UInput
              v-if="editingId === row.original.id"
              :model-value="priceValue"
              :aria-label="`Precio de lista de ${row.original.name}`"
              inputmode="decimal"
              :disabled="saving"
              class="w-full"
              @update:model-value="(value: string | number) => (priceValue = String(value))"
            />
            <MoneyAmount v-else :value="row.original.listPrice" />
          </template>
          <template #actions-cell="{ row }">
            <div v-if="editingId === row.original.id" class="flex justify-end gap-2">
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
                @click="savePrice(row.original.id)"
              />
            </div>
            <div v-else class="flex justify-end gap-2">
              <UButton
                color="neutral"
                variant="ghost"
                size="sm"
                label="Cambios de precio"
                :disabled="saving"
                @click="togglePriceChanges(row.original.id)"
              />
              <UButton
                color="neutral"
                variant="ghost"
                size="sm"
                label="Cambiar precio"
                :disabled="saving"
                @click="startEdit(row.original)"
              />
            </div>
          </template>
          <!-- Debajo de su fila: el historial de precios y el error de una acción. -->
          <template #expanded="{ row }">
            <UPageBody>
              <template v-if="historyProductId === row.original.id">
                <h2>Cambios de precio</h2>
                <p v-if="loadingPriceChanges" role="status">Cargando cambios…</p>
                <p v-else-if="priceChanges.length === 0">
                  Todavía no hay cambios de precio registrados.
                </p>
                <ul v-else>
                  <li v-for="change in priceChanges" :key="change.id">
                    {{ formatInstantInLima(change.changedAt) }} · {{ change.changedBy.name }}:
                    {{
                      change.previousPrice === null
                        ? "sin precio anterior"
                        : formatSoles(change.previousPrice)
                    }}
                    a {{ formatSoles(change.newPrice) }}
                  </li>
                </ul>
              </template>
              <UAlert
                v-if="rowError?.productId === row.original.id"
                role="alert"
                color="error"
                variant="subtle"
                :title="rowError.message"
              />
            </UPageBody>
          </template>
        </UTable>
      </UCard>
    </UPageBody>

    <UModal v-model:open="newAccessoryOpen" title="Nuevo accesorio">
      <template #body>
        <UForm
          :state="{}"
          :validate-on="[]"
          :loading-auto="false"
          novalidate
          aria-label="Nuevo accesorio"
          @submit="createAccessory"
        >
          <UAlert
            v-if="newAccessoryError"
            role="alert"
            color="error"
            variant="subtle"
            :title="newAccessoryError"
          />

          <UFormField label="Nombre del accesorio" required>
            <UInput
              v-model="newAccessoryName"
              placeholder="Ej. Surtidor manual"
              :disabled="creatingAccessory"
              class="w-full"
            />
          </UFormField>

          <UFormField
            label="Precio de lista"
            required
            help="En soles, con hasta dos decimales (ej. 15.00)"
          >
            <UInput
              v-model="newAccessoryPrice"
              inputmode="decimal"
              placeholder="15.00"
              :disabled="creatingAccessory"
              class="w-full"
            >
              <template #leading>S/</template>
            </UInput>
          </UFormField>

          <div class="flex justify-end gap-2">
            <UButton
              color="neutral"
              variant="outline"
              label="Cancelar"
              :disabled="creatingAccessory"
              @click="newAccessoryOpen = false"
            />
            <UButton type="submit" label="Guardar accesorio" :loading="creatingAccessory" />
          </div>
        </UForm>
      </template>
    </UModal>

    <UModal v-model:open="newMaquilaOpen" title="Nuevo servicio de maquila">
      <template #body>
        <UForm
          :state="{}"
          :validate-on="[]"
          :loading-auto="false"
          novalidate
          aria-label="Nuevo servicio de maquila"
          @submit="createMaquilaService"
        >
          <UAlert
            v-if="newMaquilaError"
            role="alert"
            color="error"
            variant="subtle"
            :title="newMaquilaError"
          />

          <UFormField label="Nombre del servicio" required>
            <UInput
              v-model="newMaquilaName"
              placeholder="Ej. Maquila con caño"
              :disabled="creatingMaquila"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Tipo de envase" required>
            <USelect
              v-model="newMaquilaContainerTypeId"
              :items="containerTypes.map((t) => ({ label: t.name, value: t.id }))"
              placeholder="Selecciona el tipo de envase"
              :disabled="creatingMaquila"
              class="w-full"
            />
          </UFormField>

          <UFormField
            label="Precio de lista"
            required
            help="En soles, con hasta dos decimales (ej. 3.50)"
          >
            <UInput
              v-model="newMaquilaPrice"
              inputmode="decimal"
              placeholder="3.50"
              :disabled="creatingMaquila"
              class="w-full"
            >
              <template #leading>S/</template>
            </UInput>
          </UFormField>

          <div class="flex justify-end gap-2">
            <UButton
              color="neutral"
              variant="outline"
              label="Cancelar"
              :disabled="creatingMaquila"
              @click="newMaquilaOpen = false"
            />
            <UButton type="submit" label="Guardar servicio" :loading="creatingMaquila" />
          </div>
        </UForm>
      </template>
    </UModal>
  </AppPage>
</template>
