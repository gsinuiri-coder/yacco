<script setup lang="ts">
import { formatSoles } from "@yacco/shared";
import type {
  AccessorySummary,
  CustomerAccessoryBalanceItem,
  CustomerLocation,
} from "@yacco/shared";
import { positiveWhole } from "../utils/quantity";

const props = defineProps<{ customerId: string }>();
const emit = defineEmits<{ statementChanged: [] }>();

const session = useSession();
const api = useApi();
const isAdmin = computed(() => session.hasRole("ADMIN"));

interface LocationBalances {
  location: CustomerLocation;
  balances: CustomerAccessoryBalanceItem[];
}

const locationsWithBalances = ref<LocationBalances[]>([]);
const accessoriesCatalog = ref<AccessorySummary[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    const [locations, catalog] = await Promise.all([
      api.request<CustomerLocation[]>(`/customers/${props.customerId}/locations`),
      api.request<AccessorySummary[]>("/accessories"),
    ]);
    accessoriesCatalog.value = catalog;

    const balancesResults = await Promise.all(
      locations.map(async (loc) => {
        const balances = await api.request<CustomerAccessoryBalanceItem[]>(
          `/customer-locations/${loc.id}/accessories`,
        );
        return {
          location: loc,
          balances,
        };
      }),
    );
    locationsWithBalances.value = balancesResults;
  } catch (error) {
    loadError.value = describeApiFailure(error);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

// --- Modal Prestar ---
const loanModalOpen = ref(false);
const loanLocationId = ref<string>("");
const loanProductId = ref<string>("");
const loanQuantity = ref("1");
const loanSubmitting = ref(false);
const loanError = ref<string | null>(null);

function startLoan(): void {
  loanLocationId.value = locationsWithBalances.value[0]?.location.id ?? "";
  loanProductId.value = accessoriesCatalog.value[0]?.id ?? "";
  loanQuantity.value = "1";
  loanError.value = null;
  loanModalOpen.value = true;
}

async function submitLoan(): Promise<void> {
  if (loanSubmitting.value || !loanLocationId.value || !loanProductId.value) return;
  const qty = positiveWhole(loanQuantity.value);
  if (qty === null) {
    loanError.value = "La cantidad debe ser un número entero mayor que 0";
    return;
  }
  loanSubmitting.value = true;
  loanError.value = null;
  try {
    await api.request(`/customer-locations/${loanLocationId.value}/accessories/loans`, {
      method: "POST",
      body: { productId: loanProductId.value, quantity: qty },
    });
    loanModalOpen.value = false;
    await load();
  } catch (error) {
    loanError.value = describeApiFailure(error);
  } finally {
    loanSubmitting.value = false;
  }
}

// --- Modal Devolver ---
const returnModalOpen = ref(false);
const returnLocationId = ref<string>("");
const returnTargetItem = ref<CustomerAccessoryBalanceItem | null>(null);
const returnQuantity = ref("1");
const returnSubmitting = ref(false);
const returnError = ref<string | null>(null);

function startReturn(locId: string, item: CustomerAccessoryBalanceItem): void {
  returnLocationId.value = locId;
  returnTargetItem.value = item;
  returnQuantity.value = "1";
  returnError.value = null;
  returnModalOpen.value = true;
}

async function submitReturn(): Promise<void> {
  if (returnSubmitting.value || !returnTargetItem.value || !returnLocationId.value) return;
  const qty = positiveWhole(returnQuantity.value);
  if (qty === null) {
    returnError.value = "La cantidad debe ser un número entero mayor que 0";
    return;
  }
  if (qty > returnTargetItem.value.quantity) {
    returnError.value = `No puedes devolver más de lo prestado (${returnTargetItem.value.quantity})`;
    return;
  }
  returnSubmitting.value = true;
  returnError.value = null;
  try {
    await api.request(`/customer-locations/${returnLocationId.value}/accessories/returns`, {
      method: "POST",
      body: { productId: returnTargetItem.value.productId, quantity: qty },
    });
    returnModalOpen.value = false;
    await load();
  } catch (error) {
    returnError.value = describeApiFailure(error);
  } finally {
    returnSubmitting.value = false;
  }
}

// --- Modal Cobrar ---
const chargeModalOpen = ref(false);
const chargeLocationId = ref<string>("");
const chargeTargetItem = ref<CustomerAccessoryBalanceItem | null>(null);
const chargeQuantity = ref("1");
const chargeReason = ref("");
const chargeUnitPrice = ref("");
const chargeSubmitting = ref(false);
const chargeError = ref<string | null>(null);

function startCharge(locId: string, item: CustomerAccessoryBalanceItem): void {
  chargeLocationId.value = locId;
  chargeTargetItem.value = item;
  chargeQuantity.value = "1";
  chargeReason.value = "";
  chargeUnitPrice.value = item.agreedPrice ?? item.listPrice;
  chargeError.value = null;
  chargeModalOpen.value = true;
}

async function submitCharge(): Promise<void> {
  if (chargeSubmitting.value || !chargeTargetItem.value || !chargeLocationId.value) return;
  const qty = positiveWhole(chargeQuantity.value);
  if (qty === null) {
    chargeError.value = "La cantidad debe ser un número entero mayor que 0";
    return;
  }
  if (qty > chargeTargetItem.value.quantity) {
    chargeError.value = `No puedes cobrar más de lo prestado (${chargeTargetItem.value.quantity})`;
    return;
  }
  const reason = chargeReason.value.trim();
  if (!reason) {
    chargeError.value = "Debes indicar el motivo del cobro (ej. extraviado o roto)";
    return;
  }
  chargeSubmitting.value = true;
  chargeError.value = null;
  try {
    await api.request(`/customer-locations/${chargeLocationId.value}/accessories/charges`, {
      method: "POST",
      body: {
        productId: chargeTargetItem.value.productId,
        quantity: qty,
        reason,
        unitPrice: chargeUnitPrice.value.trim() || undefined,
      },
    });
    chargeModalOpen.value = false;
    emit("statementChanged");
    await load();
  } catch (error) {
    chargeError.value = describeApiFailure(error);
  } finally {
    chargeSubmitting.value = false;
  }
}

const totalBorrowedCount = computed(() =>
  locationsWithBalances.value.reduce(
    (sum, loc) => sum + loc.balances.reduce((s, b) => s + b.quantity, 0),
    0,
  ),
);
const columns = [
  { accessorKey: "productName", header: "Accesorio" },
  { accessorKey: "quantity", header: "Prestados", meta: RIGHT_ALIGNED },
  { id: "price", header: "Precio ref.", meta: RIGHT_ALIGNED },
  { id: "actions", header: hiddenHeader("Acciones"), meta: RIGHT_ALIGNED },
];
</script>

<template>
  <SectionCard
    title="Accesorios prestados"
    description="Accesorios entregados en comodato o préstamo por local."
  >
    <template #actions>
      <UButton
        v-if="accessoriesCatalog.length > 0 && locationsWithBalances.length > 0"
        color="neutral"
        variant="outline"
        size="sm"
        icon="i-lucide-plus"
        label="Prestar accesorio"
        @click="startLoan"
      />
    </template>

    <ListStatus
      v-if="loadError || loading || locationsWithBalances.length === 0"
      :error-message="loadError"
      :loading="loading"
      :empty="locationsWithBalances.length === 0"
      loading-label="Cargando accesorios prestados…"
      empty-icon="i-lucide-wrench"
      empty-title="Sin locales"
      empty-description="Este cliente no tiene locales registrados."
      @retry="load"
    />

    <UPageBody v-else>
      <UPageCard v-for="entry in locationsWithBalances" :key="entry.location.id" variant="soft">
        <template #title>
          {{ entry.location.name }}
          <UBadge
            v-if="!entry.location.active"
            color="warning"
            variant="subtle"
            label="Local retirado"
          />
        </template>

        <UAlert
          v-if="entry.balances.length === 0"
          color="neutral"
          variant="soft"
          title="Sin accesorios prestados en este local."
        />

        <UTable
          v-else
          :data="entry.balances"
          :columns="columns"
          :caption="`Accesorios prestados en ${entry.location.name}`"
        >
          <template #price-cell="{ row }">
            {{ formatSoles(row.original.agreedPrice ?? row.original.listPrice) }}
          </template>
          <template #actions-cell="{ row }">
            <div class="flex justify-end gap-2">
              <UButton
                color="neutral"
                variant="ghost"
                size="sm"
                label="Devolver"
                @click="startReturn(entry.location.id, row.original)"
              />
              <UButton
                v-if="isAdmin"
                color="warning"
                variant="ghost"
                size="sm"
                label="Cobrar"
                @click="startCharge(entry.location.id, row.original)"
              />
            </div>
          </template>
        </UTable>
      </UPageCard>

      <UAlert
        v-if="totalBorrowedCount > 0"
        color="info"
        variant="soft"
        :title="`Total prestado al cliente: ${totalBorrowedCount} ${
          totalBorrowedCount === 1 ? 'accesorio' : 'accesorios'
        }`"
      />
    </UPageBody>

    <!-- Modal Prestar -->
    <UModal v-model:open="loanModalOpen" title="Prestar accesorio a local">
      <template #body>
        <UForm :state="{}" :validate-on="[]" :loading-auto="false" novalidate @submit="submitLoan">
          <UAlert v-if="loanError" role="alert" color="error" variant="subtle" :title="loanError" />

          <UFormField label="Local del cliente" required>
            <USelect
              v-model="loanLocationId"
              class="w-full"
              :items="
                locationsWithBalances.map((e) => ({
                  label: e.location.name,
                  value: e.location.id,
                }))
              "
            />
          </UFormField>

          <UFormField label="Accesorio" required>
            <USelect
              v-model="loanProductId"
              class="w-full"
              :items="accessoriesCatalog.map((a) => ({ label: a.name, value: a.id }))"
            />
          </UFormField>

          <UFormField label="Cantidad a prestar" required>
            <UInput
              v-model="loanQuantity"
              class="w-full"
              type="number"
              min="1"
              step="1"
              placeholder="1"
              :disabled="loanSubmitting"
            />
          </UFormField>

          <div class="flex justify-end gap-2">
            <UButton
              color="neutral"
              variant="outline"
              label="Cancelar"
              :disabled="loanSubmitting"
              @click="loanModalOpen = false"
            />
            <UButton type="submit" label="Registrar préstamo" :loading="loanSubmitting" />
          </div>
        </UForm>
      </template>
    </UModal>

    <!-- Modal Devolver -->
    <UModal
      v-model:open="returnModalOpen"
      :title="`Devolver accesorio: ${returnTargetItem?.productName}`"
    >
      <template #body>
        <UForm
          :state="{}"
          :validate-on="[]"
          :loading-auto="false"
          novalidate
          @submit="submitReturn"
        >
          <UAlert
            v-if="returnError"
            role="alert"
            color="error"
            variant="subtle"
            :title="returnError"
          />

          <UAlert
            color="info"
            variant="soft"
            :title="`Cantidad actualmente prestada: ${returnTargetItem?.quantity ?? ''}`"
          />

          <UFormField label="Cantidad a devolver a planta" required>
            <UInput
              v-model="returnQuantity"
              class="w-full"
              type="number"
              min="1"
              step="1"
              :disabled="returnSubmitting"
            />
          </UFormField>

          <div class="flex justify-end gap-2">
            <UButton
              color="neutral"
              variant="outline"
              label="Cancelar"
              :disabled="returnSubmitting"
              @click="returnModalOpen = false"
            />
            <UButton type="submit" label="Registrar devolución" :loading="returnSubmitting" />
          </div>
        </UForm>
      </template>
    </UModal>

    <!-- Modal Cobrar -->
    <UModal
      v-model:open="chargeModalOpen"
      :title="`Cobrar accesorio prestado: ${chargeTargetItem?.productName}`"
    >
      <template #body>
        <UForm
          :state="{}"
          :validate-on="[]"
          :loading-auto="false"
          novalidate
          @submit="submitCharge"
        >
          <UAlert
            v-if="chargeError"
            role="alert"
            color="error"
            variant="subtle"
            :title="chargeError"
          />

          <UAlert
            color="warning"
            variant="soft"
            description="Al cobrar este accesorio prestado, se descuenta de los prestados y se genera una venta fiada que incrementa la deuda en soles del cliente."
          />

          <UFormField label="Cantidad a cobrar" required>
            <UInput
              v-model="chargeQuantity"
              class="w-full"
              type="number"
              min="1"
              :max="chargeTargetItem?.quantity"
              step="1"
              :disabled="chargeSubmitting"
            />
          </UFormField>

          <UFormField
            label="Motivo del cobro"
            required
            help="Ej. Cliente extravió el surtidor, o se devolvió roto"
          >
            <UInput
              v-model="chargeReason"
              class="w-full"
              placeholder="Motivo del cobro"
              :disabled="chargeSubmitting"
            />
          </UFormField>

          <UFormField label="Precio unitario" help="Precio a cobrar por cada unidad">
            <UInput
              v-model="chargeUnitPrice"
              class="w-full"
              inputmode="decimal"
              placeholder="35.00"
              :disabled="chargeSubmitting"
            >
              <template #leading><span>S/</span></template>
            </UInput>
          </UFormField>

          <div class="flex justify-end gap-2">
            <UButton
              color="neutral"
              variant="outline"
              label="Cancelar"
              :disabled="chargeSubmitting"
              @click="chargeModalOpen = false"
            />
            <UButton
              type="submit"
              color="warning"
              label="Cobrar accesorio"
              :loading="chargeSubmitting"
            />
          </div>
        </UForm>
      </template>
    </UModal>
  </SectionCard>
</template>
