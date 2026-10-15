<script setup lang="ts">
import {
  formatInstantInLima,
  formatSoles,
  isAboveZero,
  isMoneyInput,
  timesQuantity,
} from "@yacco/shared";
import type {
  ContainerType,
  CustomerLocation,
  EffectivePrice,
  MaquilaBalanceItem,
  MaquilaMovementItem,
  MaquilaMovementType,
  PaginatedMaquilaMovements,
  PaymentMethod,
} from "@yacco/shared";
import { positiveWhole } from "../utils/quantity";

const props = defineProps<{ customerId: string }>();
const emit = defineEmits<{ statementChanged: [] }>();

const session = useSession();
const api = useApi();
const isAdmin = computed(() => session.hasRole("ADMIN"));
const canVoidFilled = computed(
  () => session.hasRole("ADMIN") || session.hasRole("PLANT_SUPERVISOR"),
);

const balances = ref<MaquilaBalanceItem[]>([]);
const movements = ref<MaquilaMovementItem[]>([]);
const containerTypes = ref<ContainerType[]>([]);
const paymentMethods = ref<PaymentMethod[]>([]);
const locations = ref<CustomerLocation[]>([]);

const loading = ref(true);
const loadError = ref<string | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    const [bals, movs, types, methods, locs] = await Promise.all([
      api.request<MaquilaBalanceItem[]>(`/maquila/customers/${props.customerId}/balances`),
      api.request<PaginatedMaquilaMovements>("/maquila/movements", {
        query: { customerId: props.customerId, limit: 20 },
      }),
      api.request<ContainerType[]>("/container-types"),
      api.request<PaymentMethod[]>("/payment-methods"),
      api.request<CustomerLocation[]>(`/customers/${props.customerId}/locations`),
    ]);
    balances.value = bals;
    movements.value = movs.data;
    containerTypes.value = types;
    paymentMethods.value = methods.filter((m) => m.active);
    locations.value = locs;
  } catch (error) {
    loadError.value = describeApiFailure(error);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

// --- Modal Recibir ---
const receiveModalOpen = ref(false);
const receiveContainerTypeId = ref("");
const receiveQuantity = ref("1");
const receiveSubmitting = ref(false);
const receiveError = ref<string | null>(null);

function openReceiveModal(): void {
  receiveContainerTypeId.value = containerTypes.value[0]?.id ?? "";
  receiveQuantity.value = "1";
  receiveError.value = null;
  receiveModalOpen.value = true;
}

async function submitReceive(): Promise<void> {
  if (receiveSubmitting.value || !receiveContainerTypeId.value) return;
  const qty = positiveWhole(receiveQuantity.value);
  if (qty === null) {
    receiveError.value = "La cantidad debe ser un número entero mayor que 0";
    return;
  }
  receiveSubmitting.value = true;
  receiveError.value = null;
  try {
    await api.request("/maquila/receptions", {
      method: "POST",
      body: {
        customerId: props.customerId,
        containerTypeId: receiveContainerTypeId.value,
        quantity: qty,
      },
    });
    receiveModalOpen.value = false;
    await load();
  } catch (error) {
    receiveError.value = describeApiFailure(error);
  } finally {
    receiveSubmitting.value = false;
  }
}

// --- Modal Devolver ---
const returnModalOpen = ref(false);
const targetBalance = ref<MaquilaBalanceItem | null>(null);
const returnQuantity = ref("1");
const returnLocationId = ref<string>("");
const payNow = ref(false);
const returnPaymentMethodId = ref<string>("");
const returnAmount = ref("");
const effectiveUnitPrice = ref<string | null>(null);
const effectivePriceLoading = ref(false);
const returnSubmitting = ref(false);
const returnError = ref<string | null>(null);
let effectivePriceRequestId = 0;

function openReturnModal(balance: MaquilaBalanceItem): void {
  targetBalance.value = balance;
  returnQuantity.value = String(Math.min(1, balance.fullToReturn));
  returnLocationId.value = locations.value[0]?.id ?? "";
  effectiveUnitPrice.value = null;
  effectivePriceLoading.value = true;
  payNow.value = false;
  returnPaymentMethodId.value = paymentMethods.value[0]?.id ?? "";
  updateCalculatedReturnAmount();
  returnError.value = null;
  returnModalOpen.value = true;
  void loadEffectiveReturnPrice();
}

async function loadEffectiveReturnPrice(): Promise<void> {
  const productId = targetBalance.value?.productId;
  const locationId = returnLocationId.value;
  const requestId = ++effectivePriceRequestId;
  effectiveUnitPrice.value = null;
  effectivePriceLoading.value = true;
  returnError.value = null;
  updateCalculatedReturnAmount();
  if (!productId) {
    effectivePriceLoading.value = false;
    return;
  }

  try {
    const prices = await api.request<EffectivePrice[]>(
      `/customers/${props.customerId}/effective-prices`,
      {
        query: locationId ? { locationId } : {},
      },
    );
    if (
      requestId !== effectivePriceRequestId ||
      locationId !== returnLocationId.value ||
      productId !== targetBalance.value?.productId
    ) {
      return;
    }
    effectiveUnitPrice.value =
      prices.find((price) => price.product.id === productId)?.price ?? null;
    updateCalculatedReturnAmount();
  } catch (error) {
    if (requestId !== effectivePriceRequestId) return;
    effectiveUnitPrice.value = null;
    returnError.value = describeApiFailure(error);
    updateCalculatedReturnAmount();
  } finally {
    if (requestId === effectivePriceRequestId) {
      effectivePriceLoading.value = false;
    }
  }
}

function updateCalculatedReturnAmount(): void {
  if (!effectiveUnitPrice.value) {
    returnAmount.value = "";
    return;
  }
  const qty = positiveWhole(returnQuantity.value) ?? 0;
  returnAmount.value = timesQuantity(effectiveUnitPrice.value, qty);
}

watch(returnQuantity, updateCalculatedReturnAmount);
watch(returnLocationId, () => {
  if (returnModalOpen.value) void loadEffectiveReturnPrice();
});
watch(returnModalOpen, (open) => {
  if (!open) {
    effectivePriceRequestId += 1;
    effectivePriceLoading.value = false;
  }
});

async function submitReturn(): Promise<void> {
  if (returnSubmitting.value || effectivePriceLoading.value || !targetBalance.value) return;
  const qty = positiveWhole(returnQuantity.value);
  if (qty === null) {
    returnError.value = "La cantidad debe ser un número entero mayor que 0";
    return;
  }
  if (qty > targetBalance.value.fullToReturn) {
    returnError.value = `No puedes devolver más de lo llenado (${targetBalance.value.fullToReturn})`;
    return;
  }
  if (!effectiveUnitPrice.value) {
    returnError.value = "Falta el precio de maquila de este cliente";
    return;
  }

  let payment: { paymentMethodId: string; amount: string } | undefined;
  if (payNow.value) {
    if (!returnPaymentMethodId.value) {
      returnError.value = "Selecciona un medio de pago";
      return;
    }
    const amt = returnAmount.value.trim();
    if (!isMoneyInput(amt) || !isAboveZero(amt)) {
      returnError.value = "El monto a pagar debe ser mayor que 0";
      return;
    }
    payment = {
      paymentMethodId: returnPaymentMethodId.value,
      amount: amt,
    };
  }

  returnSubmitting.value = true;
  returnError.value = null;
  try {
    await api.request("/maquila/returns", {
      method: "POST",
      body: {
        customerId: props.customerId,
        containerTypeId: targetBalance.value.containerTypeId,
        quantity: qty,
        locationId: returnLocationId.value || undefined,
        payment,
      },
    });
    returnModalOpen.value = false;
    emit("statementChanged");
    await load();
  } catch (error) {
    returnError.value = describeApiFailure(error);
  } finally {
    returnSubmitting.value = false;
  }
}

// --- Modal Anular Movimiento ---
const { openVoidModal, submitVoid, voidError, voidModalOpen, voidReason, voidSubmitting } =
  useMaquilaVoid(async () => {
    emit("statementChanged");
    await load();
  });

const TYPE_CONFIG: Record<
  MaquilaMovementType,
  { label: string; color: "info" | "primary" | "success" | "error" | "neutral" }
> = {
  RECEIVED: { label: "Recibido", color: "info" },
  FILLED: { label: "Llenado", color: "neutral" },
  RETURNED: { label: "Devuelto", color: "success" },
  RECEIVED_VOID: { label: "Recibido (Anulado)", color: "error" },
  FILLED_VOID: { label: "Llenado (Anulado)", color: "error" },
  RETURNED_VOID: { label: "Devuelto (Anulado)", color: "error" },
};

function canVoid(mov: MaquilaMovementItem): boolean {
  if (mov.reversesMovementId !== null) return false;
  if (mov.type.endsWith("_VOID")) return false;
  // If already reversed by another movement:
  const isReversed = movements.value.some((m) => m.reversesMovementId === mov.id);
  if (isReversed) return false;

  if (mov.type === "FILLED") return canVoidFilled.value;
  if (mov.type === "RECEIVED" || mov.type === "RETURNED") return isAdmin.value;
  return false;
}

const movementColumns = [
  { accessorKey: "occurredAt", header: "Fecha" },
  { accessorKey: "type", header: "Tipo" },
  { accessorKey: "containerTypeName", header: "Envase" },
  { accessorKey: "quantity", header: "Cant.", meta: RIGHT_ALIGNED },
  { accessorKey: "saleTotal", header: "Cargo S/", meta: RIGHT_ALIGNED },
  { accessorKey: "recordedByName", header: "Registrado por" },
  { id: "actions", header: hiddenHeader("Acciones"), meta: RIGHT_ALIGNED },
];
</script>

<template>
  <SectionCard
    title="Maquila"
    description="Bidones del cliente en planta. No forman parte de la flota propia."
  >
    <template #actions>
      <UButton
        color="neutral"
        variant="outline"
        size="sm"
        icon="i-lucide-arrow-down-left"
        label="Recibir bidones"
        @click="openReceiveModal"
      />
    </template>

    <ListStatus
      v-if="loadError || loading"
      :error-message="loadError"
      :loading="loading"
      :empty="false"
      loading-label="Cargando maquila…"
      empty-title=""
      empty-description=""
      @retry="load"
    />

    <UPageBody v-else>
      <UPageCard variant="soft">
        <template #title>
          <h3>Saldos actuales de maquila</h3>
        </template>
        <UAlert
          v-if="balances.length === 0"
          color="neutral"
          variant="soft"
          title="Este cliente no tiene bidones registrados en planta."
        />
        <UPageList v-else>
          <UPageCard
            v-for="balance in balances"
            :key="balance.containerTypeId"
            as="li"
            :title="balance.containerTypeName"
            variant="soft"
          >
            <div class="flex flex-wrap items-center gap-2">
              <UBadge
                :color="balance.emptyAtPlant > 0 ? 'info' : 'neutral'"
                variant="subtle"
                :label="`${balance.emptyAtPlant} vacíos en planta`"
              />
              <UBadge
                :color="balance.fullToReturn > 0 ? 'success' : 'neutral'"
                variant="subtle"
                :label="`${balance.fullToReturn} llenos por devolver`"
              />
            </div>
            <p>
              Precio de maquila:
              <span>{{
                balance.unitPrice != null ? formatSoles(balance.unitPrice) : "Sin precio registrado"
              }}</span>
            </p>
            <!-- En el slot por defecto y no en #footer: UPageCard pinta el footer
                 antes del contenido, y la acción quedaría arriba de los saldos. -->
            <div v-if="balance.fullToReturn > 0">
              <UButton
                size="sm"
                icon="i-lucide-arrow-up-right"
                label="Devolver llenos"
                @click="openReturnModal(balance)"
              />
            </div>
          </UPageCard>
        </UPageList>
      </UPageCard>

      <UPageCard v-if="movements.length > 0" variant="soft">
        <template #title>
          <h3>Movimientos de maquila</h3>
        </template>
        <UTable :data="movements" :columns="movementColumns" caption="Movimientos de maquila">
          <template #occurredAt-cell="{ row }">
            {{ formatInstantInLima(row.original.occurredAt) }}
          </template>
          <template #type-cell="{ row }">
            <UBadge
              :color="TYPE_CONFIG[row.original.type].color"
              variant="subtle"
              size="xs"
              :label="TYPE_CONFIG[row.original.type].label"
            />
            <p v-if="row.original.reason">Motivo: {{ row.original.reason }}</p>
          </template>
          <template #saleTotal-cell="{ row }">
            {{ row.original.saleTotal ? formatSoles(row.original.saleTotal) : "—" }}
          </template>
          <template #actions-cell="{ row }">
            <UButton
              v-if="canVoid(row.original)"
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-ban"
              label="Anular"
              @click="openVoidModal(row.original)"
            />
          </template>
        </UTable>
      </UPageCard>
    </UPageBody>

    <!-- Modal Recibir -->
    <UModal v-model:open="receiveModalOpen" title="Recibir bidones del cliente">
      <template #body>
        <UForm :state="{}" :validate-on="[]" :loading-auto="false" @submit="submitReceive">
          <UAlert
            v-if="receiveError"
            role="alert"
            color="error"
            variant="subtle"
            :title="receiveError"
          />

          <UFormField label="Tipo de envase" required>
            <USelect
              v-model="receiveContainerTypeId"
              class="w-full"
              :items="containerTypes.map((t) => ({ label: t.name, value: t.id }))"
              :disabled="receiveSubmitting"
            />
          </UFormField>

          <UFormField label="Cantidad de vacíos dejados" required>
            <UInput
              v-model="receiveQuantity"
              class="w-full"
              type="number"
              :min="1"
              :step="1"
              :disabled="receiveSubmitting"
            />
          </UFormField>

          <div class="flex justify-end gap-2">
            <UButton
              color="neutral"
              variant="outline"
              label="Cancelar"
              :disabled="receiveSubmitting"
              @click="receiveModalOpen = false"
            />
            <UButton type="submit" label="Registrar recepción" :loading="receiveSubmitting" />
          </div>
        </UForm>
      </template>
    </UModal>

    <!-- Modal Devolver -->
    <UModal v-model:open="returnModalOpen" title="Devolver bidones llenos (se lleva el cliente)">
      <template #body>
        <UForm :state="{}" :validate-on="[]" :loading-auto="false" @submit="submitReturn">
          <UAlert
            v-if="returnError"
            role="alert"
            color="error"
            variant="subtle"
            :title="returnError"
          />

          <UPageCard v-if="targetBalance" variant="soft">
            <p>
              Envase: <span>{{ targetBalance.containerTypeName }}</span>
            </p>
            <p>
              Llenos disponibles para devolver:
              <span>{{ targetBalance.fullToReturn }}</span>
            </p>
            <p>
              Precio unitario de maquila:
              <span v-if="effectivePriceLoading">Consultando precio…</span>
              <span v-else-if="effectiveUnitPrice">{{ formatSoles(effectiveUnitPrice) }}</span>
              <span v-else class="text-error">Falta el precio de maquila de este cliente</span>
            </p>
          </UPageCard>

          <UAlert
            v-if="targetBalance && !effectivePriceLoading && !effectiveUnitPrice"
            color="error"
            variant="subtle"
            icon="i-lucide-alert-circle"
            title="Falta el precio de maquila"
            description="No se puede devolver sin precio. Registra el precio de lista o precio pactado en Productos para este tipo de envase."
          />

          <UFormField label="Cantidad que se lleva" required>
            <UInput
              v-model="returnQuantity"
              class="w-full"
              type="number"
              :min="1"
              :max="targetBalance?.fullToReturn"
              :step="1"
              :disabled="returnSubmitting || effectivePriceLoading || !effectiveUnitPrice"
            />
          </UFormField>

          <UAlert
            v-if="effectiveUnitPrice"
            color="info"
            variant="soft"
            title="Total a cobrar por el servicio:"
            :description="formatSoles(returnAmount || '0.00')"
          />

          <UFormField v-if="locations.length > 0" label="Local del cliente (opcional)">
            <USelect
              v-model="returnLocationId"
              class="w-full"
              :items="locations.map((location) => ({ label: location.name, value: location.id }))"
              :disabled="returnSubmitting"
            />
          </UFormField>

          <!-- Cobro -->
          <UPageCard title="Modalidad de cobro" variant="soft">
            <UFieldGroup>
              <UButton
                size="xs"
                :color="!payNow ? 'primary' : 'neutral'"
                :variant="!payNow ? 'solid' : 'outline'"
                label="Al fiado (deuda en S/)"
                @click="payNow = false"
              />
              <UButton
                size="xs"
                :color="payNow ? 'primary' : 'neutral'"
                :variant="payNow ? 'solid' : 'outline'"
                label="Cobrar ahora"
                @click="payNow = true"
              />
            </UFieldGroup>

            <UPageBody v-if="payNow">
              <UFormField label="Medio de pago" required>
                <USelect
                  v-model="returnPaymentMethodId"
                  class="w-full"
                  :items="paymentMethods.map((m) => ({ label: m.name, value: m.id }))"
                  :disabled="returnSubmitting"
                />
              </UFormField>

              <UFormField label="Monto cobrado" required>
                <UInput
                  v-model="returnAmount"
                  class="w-full"
                  inputmode="decimal"
                  :disabled="returnSubmitting"
                >
                  <template #leading><span>S/</span></template>
                </UInput>
              </UFormField>
            </UPageBody>
          </UPageCard>

          <div class="flex justify-end gap-2">
            <UButton
              color="neutral"
              variant="outline"
              label="Cancelar"
              :disabled="returnSubmitting"
              @click="returnModalOpen = false"
            />
            <UButton
              type="submit"
              label="Registrar devolución"
              :loading="returnSubmitting"
              :disabled="effectivePriceLoading || !effectiveUnitPrice"
            />
          </div>
        </UForm>
      </template>
    </UModal>

    <!-- Modal Anular Movimiento -->
    <UModal v-model:open="voidModalOpen" title="Anular movimiento de maquila">
      <template #body>
        <UForm :state="{}" :validate-on="[]" :loading-auto="false" @submit="submitVoid">
          <UAlert v-if="voidError" role="alert" color="error" variant="subtle" :title="voidError" />

          <UAlert
            color="warning"
            variant="soft"
            description="La anulación emite un movimiento inverso auditable en el libro. Si anulas una devolución, también se anulará la venta y el cobro asociado."
          />

          <UFormField label="Motivo de la anulación" required>
            <UInput
              v-model="voidReason"
              class="w-full"
              placeholder="Ej. Error en la cantidad anotada"
              :disabled="voidSubmitting"
            />
          </UFormField>

          <div class="flex justify-end gap-2">
            <UButton
              color="neutral"
              variant="outline"
              label="Cancelar"
              :disabled="voidSubmitting"
              @click="voidModalOpen = false"
            />
            <UButton
              type="submit"
              color="error"
              label="Anular movimiento"
              :loading="voidSubmitting"
            />
          </div>
        </UForm>
      </template>
    </UModal>
  </SectionCard>
</template>
