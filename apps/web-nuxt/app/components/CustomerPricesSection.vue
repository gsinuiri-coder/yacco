<script setup lang="ts">
import { formatSoles, isMoneyInput } from "@yacco/shared";
import type { CustomerPrice, EffectivePrice, Product } from "@yacco/shared";

/**
 * Precios pactados del cliente.
 *
 * ADMIN gestiona (alta, edición, baja) la lista de pactados. Cualquier otro
 * rol lee los precios EFECTIVOS, de sólo lectura: la API le niega la lista de
 * gestión a un vendedor. Esconder los controles acá es claridad; la barrera de
 * seguridad está en la API.
 */
const props = defineProps<{ customerId: string; isAdmin: boolean }>();

const api = useApi();
const base = computed(() => `/customers/${props.customerId}`);
const PRICE_FORMAT_ERROR = 'El precio debe ser un monto válido, como "12.50"';

const products = ref<Product[]>([]);
const prices = ref<CustomerPrice[]>([]);
const effective = ref<EffectivePrice[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    if (props.isAdmin) {
      const [productList, priceList] = await Promise.all([
        api.request<Product[]>("/products"),
        api.request<CustomerPrice[]>(`${base.value}/prices`),
      ]);
      products.value = productList;
      prices.value = priceList;
    } else {
      effective.value = await api.request<EffectivePrice[]>(`${base.value}/effective-prices`);
    }
  } catch (error) {
    loadError.value = describeApiFailure(error);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

// Alta. No se prellena con el precio de lista: un pactado es una decisión, y
// dejar el de lista escrito invita a guardarlo sin mirarlo.
const adding = ref(false);
const newProductId = ref<string | undefined>(undefined);
const newPrice = ref("");
const createError = ref<string | null>(null);
const creating = ref(false);
const productItems = computed(() =>
  products.value.map((product) => ({ label: product.name, value: product.id })),
);
const chosenProduct = computed(() =>
  products.value.find((product) => product.id === newProductId.value),
);

function startAdd(): void {
  adding.value = true;
  newProductId.value = undefined;
  newPrice.value = "";
  createError.value = null;
}

async function create(): Promise<void> {
  if (creating.value) return;
  if (newProductId.value === undefined) {
    createError.value = "Elige un producto";
    return;
  }
  const price = newPrice.value.trim();
  if (!isMoneyInput(price)) {
    createError.value = PRICE_FORMAT_ERROR;
    return;
  }
  creating.value = true;
  createError.value = null;
  try {
    const created = await api.request<CustomerPrice>(`${base.value}/prices`, {
      method: "POST",
      body: { productId: newProductId.value, price },
    });
    prices.value = [...prices.value, created];
    adding.value = false;
  } catch (error) {
    // El mensaje de la API nombra el producto ("ya existe un precio para…").
    createError.value = describeApiFailure(error);
  } finally {
    creating.value = false;
  }
}

// Acciones de fila. El error lleva el id del precio: se muestra pegado a la
// fila que falló, no arriba, donde con muchos productos no dice cuál fue.
const editingId = ref<string | null>(null);
const editPrice = ref("");
const deletingId = ref<string | null>(null);
const rowError = ref<{ priceId: string; message: string } | null>(null);
const saving = ref(false);

function startEdit(price: CustomerPrice): void {
  editingId.value = price.id;
  editPrice.value = price.price;
  deletingId.value = null;
  rowError.value = null;
}

async function saveEdit(priceId: string): Promise<void> {
  if (saving.value) return;
  const price = editPrice.value.trim();
  if (!isMoneyInput(price)) {
    rowError.value = { priceId, message: PRICE_FORMAT_ERROR };
    return;
  }
  saving.value = true;
  rowError.value = null;
  try {
    const updated = await api.request<CustomerPrice>(`${base.value}/prices/${priceId}`, {
      method: "PATCH",
      body: { price },
    });
    prices.value = prices.value.map((item) => (item.id === priceId ? updated : item));
    editingId.value = null;
  } catch (error) {
    rowError.value = { priceId, message: describeApiFailure(error) };
  } finally {
    saving.value = false;
  }
}

function startDelete(priceId: string): void {
  deletingId.value = priceId;
  editingId.value = null;
  rowError.value = null;
}

async function confirmDelete(priceId: string): Promise<void> {
  if (saving.value) return;
  saving.value = true;
  rowError.value = null;
  try {
    await api.request<void>(`${base.value}/prices/${priceId}`, { method: "DELETE" });
    prices.value = prices.value.filter((item) => item.id !== priceId);
    deletingId.value = null;
  } catch (error) {
    rowError.value = { priceId, message: describeApiFailure(error) };
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <SectionCard
    title="Precios pactados"
    description="Lo que paga este cliente cuando no rige el precio de lista."
  >
    <template v-if="isAdmin && !adding" #actions>
      <UButton
        color="neutral"
        variant="outline"
        icon="i-lucide-plus"
        label="Agregar precio"
        :disabled="loading"
        @click="startAdd"
      />
    </template>

    <ListStatus
      v-if="loadError || loading"
      :error-message="loadError"
      :loading="loading"
      :empty="false"
      loading-label="Cargando precios…"
      error-title="No se pudieron cargar los precios"
      empty-title=""
      empty-description=""
      @retry="load"
    />

    <div v-else-if="isAdmin" class="space-y-4">
      <UAlert v-if="createError" role="alert" color="error" variant="subtle" :title="createError" />

      <form
        v-if="adding"
        class="grid gap-4 rounded-md bg-elevated p-4 sm:grid-cols-[1fr_12rem] sm:items-start"
        novalidate
        @submit.prevent="create"
      >
        <UFormField label="Producto" name="newPriceProduct">
          <USelect
            v-model="newProductId"
            :items="productItems"
            placeholder="Selecciona un producto"
            :disabled="creating"
            class="w-full"
          />
        </UFormField>
        <UFormField
          label="Precio pactado"
          name="newPriceValue"
          :help="
            chosenProduct ? `Precio de lista: ${formatSoles(chosenProduct.listPrice)}` : undefined
          "
        >
          <UInput
            v-model="newPrice"
            inputmode="decimal"
            placeholder="12.50"
            :disabled="creating"
            class="w-full"
          />
        </UFormField>
        <div class="flex justify-end gap-2 sm:col-span-2">
          <UButton
            color="neutral"
            variant="ghost"
            label="Cancelar"
            :disabled="creating"
            @click="adding = false"
          />
          <UButton
            type="submit"
            :disabled="creating"
            :label="creating ? 'Guardando…' : 'Guardar precio'"
          />
        </div>
      </form>

      <p v-if="prices.length === 0" class="py-6 text-center text-muted">
        Este cliente no tiene precios pactados: rige el precio de lista para todos sus productos.
      </p>

      <table v-else class="w-full text-sm">
        <caption class="sr-only">
          Precios pactados del cliente
        </caption>
        <thead class="text-left text-xs tracking-wide text-muted uppercase">
          <tr>
            <th scope="col" class="py-2 font-medium">Producto</th>
            <th scope="col" class="py-2 text-right font-medium">Precio</th>
            <th scope="col" class="py-2"><span class="sr-only">Acciones</span></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-default">
          <template v-for="price in prices" :key="price.id">
            <tr>
              <td class="py-3 font-medium text-highlighted">{{ price.product.name }}</td>
              <td class="py-3 text-right tabular-nums">
                <UInput
                  v-if="editingId === price.id"
                  v-model="editPrice"
                  :aria-label="`Precio de ${price.product.name}`"
                  inputmode="decimal"
                  :disabled="saving"
                  class="ml-auto w-32"
                />
                <template v-else>{{ formatSoles(price.price) }}</template>
              </td>
              <td class="py-3 text-right">
                <div
                  v-if="deletingId === price.id"
                  class="flex flex-wrap items-center justify-end gap-2"
                >
                  <span class="text-muted">¿Eliminar? Volverá a regir el precio de lista.</span>
                  <UButton
                    color="neutral"
                    variant="outline"
                    size="sm"
                    label="No"
                    :disabled="saving"
                    @click="deletingId = null"
                  />
                  <UButton
                    color="error"
                    size="sm"
                    :disabled="saving"
                    :label="saving ? 'Eliminando…' : 'Sí, eliminar'"
                    @click="confirmDelete(price.id)"
                  />
                </div>
                <div v-else-if="editingId === price.id" class="flex justify-end gap-2">
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
                    :disabled="saving"
                    :label="saving ? 'Guardando…' : 'Guardar'"
                    @click="saveEdit(price.id)"
                  />
                </div>
                <div v-else class="flex justify-end gap-1">
                  <UButton
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    label="Editar"
                    :aria-label="`Editar precio de ${price.product.name}`"
                    @click="startEdit(price)"
                  />
                  <UButton
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    label="Eliminar"
                    :aria-label="`Eliminar precio de ${price.product.name}`"
                    @click="startDelete(price.id)"
                  />
                </div>
              </td>
            </tr>
            <tr v-if="rowError?.priceId === price.id">
              <td colspan="3" class="pb-3">
                <UAlert role="alert" color="error" variant="subtle" :title="rowError.message" />
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <table v-else class="w-full text-sm">
      <caption class="sr-only">
        Precios efectivos del cliente
      </caption>
      <thead class="text-left text-xs tracking-wide text-muted uppercase">
        <tr>
          <th scope="col" class="py-2 font-medium">Producto</th>
          <th scope="col" class="py-2 text-right font-medium">Precio</th>
          <th scope="col" class="py-2 pl-4 font-medium">Origen</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-default">
        <tr v-for="item in effective" :key="item.product.id">
          <td class="py-3 font-medium text-highlighted">{{ item.product.name }}</td>
          <td class="py-3 text-right tabular-nums">{{ formatSoles(item.price) }}</td>
          <td class="py-3 pl-4">
            <span v-if="item.source === 'LIST'" class="text-muted">Precio de lista</span>
            <UBadge v-else color="info" variant="subtle" label="Pactado" />
          </td>
        </tr>
      </tbody>
    </table>
  </SectionCard>
</template>
