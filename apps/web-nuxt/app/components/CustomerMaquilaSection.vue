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
const returnSubmitting = ref(false);
const returnError = ref<string | null>(null);

function openReturnModal(balance: MaquilaBalanceItem): void {
  targetBalance.value = balance;
  returnQuantity.value = String(Math.min(1, balance.fullToReturn));
  returnLocationId.value = locations.value[0]?.id ?? "";
  effectiveUnitPrice.value = balance.unitPrice;
  payNow.value = false;
  returnPaymentMethodId.value = paymentMethods.value[0]?.id ?? "";
  updateCalculatedReturnAmount();
  returnError.value = null;
  returnModalOpen.value = true;
  void loadEffectiveReturnPrice();
}

async function loadEffectiveReturnPrice(): Promise<void> {
  const productId = targetBalance.value?.productId;
  if (!productId) {
    effectiveUnitPrice.value = null;
    updateCalculatedReturnAmount();
    return;
  }

  try {
    const prices = await api.request<EffectivePrice[]>(
      `/customers/${props.customerId}/effective-prices`,
      {
        query: returnLocationId.value ? { locationId: returnLocationId.value } : {},
      },
    );
    effectiveUnitPrice.value =
      prices.find((price) => price.product.id === productId)?.price ?? null;
    updateCalculatedReturnAmount();
  } catch (error) {
    effectiveUnitPrice.value = null;
    returnError.value = describeApiFailure(error);
    updateCalculatedReturnAmount();
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

async function submitReturn(): Promise<void> {
  if (returnSubmitting.value || !targetBalance.value) return;
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
const voidModalOpen = ref(false);
const targetMovement = ref<MaquilaMovementItem | null>(null);
const voidReason = ref("");
const voidSubmitting = ref(false);
const voidError = ref<string | null>(null);

function openVoidModal(movement: MaquilaMovementItem): void {
  targetMovement.value = movement;
  voidReason.value = "";
  voidError.value = null;
  voidModalOpen.value = true;
}

async function submitVoid(): Promise<void> {
  if (voidSubmitting.value || !targetMovement.value) return;
  const reason = voidReason.value.trim();
  if (reason.length < 3) {
    voidError.value = "El motivo debe tener al menos 3 caracteres";
    return;
  }
  voidSubmitting.value = true;
  voidError.value = null;
  try {
    await api.request(`/maquila/movements/${targetMovement.value.id}/void`, {
      method: "POST",
      body: { reason },
    });
    voidModalOpen.value = false;
    emit("statementChanged");
    await load();
  } catch (error) {
    voidError.value = describeApiFailure(error);
  } finally {
    voidSubmitting.value = false;
  }
}

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

    <div v-else class="space-y-6">
      <!-- Saldos -->
      <div>
        <h3 class="mb-3 text-xs font-medium tracking-wide text-muted uppercase">
          Saldos actuales de maquila
        </h3>
        <div v-if="balances.length === 0" class="text-sm text-muted">
          Este cliente no tiene bidones registrados en planta.
        </div>
        <div v-else class="divide-y divide-default rounded-md border border-default">
          <div
            v-for="b in balances"
            :key="b.containerTypeId"
            class="flex flex-wrap items-center justify-between gap-4 p-3"
          >
            <div>
              <p class="font-medium text-highlighted">{{ b.containerTypeName }}</p>
              <div class="mt-1 flex flex-wrap gap-2 text-xs">
                <UBadge
                  :color="b.emptyAtPlant > 0 ? 'info' : 'neutral'"
                  variant="subtle"
                  :label="`${b.emptyAtPlant} vacíos en planta`"
                />
                <UBadge
                  :color="b.fullToReturn > 0 ? 'success' : 'neutral'"
                  variant="subtle"
                  :label="`${b.fullToReturn} llenos por devolver`"
                />
              </div>
              <p class="mt-1 text-xs text-muted">
                Precio de maquila:
                <span class="font-medium text-highlighted">
                  {{ b.unitPrice !== null ? formatSoles(b.unitPrice) : "Sin precio registrado" }}
                </span>
              </p>
            </div>
            <div>
              <UButton
                v-if="b.fullToReturn > 0"
                size="sm"
                icon="i-lucide-arrow-up-right"
                label="Devolver llenos"
                @click="openReturnModal(b)"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Movimientos recientes -->
      <div v-if="movements.length > 0">
        <h3 class="mb-3 text-xs font-medium tracking-wide text-muted uppercase">
          Movimientos de maquila
        </h3>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead class="bg-elevated text-muted uppercase">
              <tr>
                <th scope="col" class="px-3 py-2 font-medium">Fecha</th>
                <th scope="col" class="px-3 py-2 font-medium">Tipo</th>
                <th scope="col" class="px-3 py-2 font-medium">Envase</th>
                <th scope="col" class="px-3 py-2 text-right font-medium">Cant.</th>
                <th scope="col" class="px-3 py-2 text-right font-medium">Cargo S/</th>
                <th scope="col" class="px-3 py-2 font-medium">Registrado por</th>
                <th scope="col" class="px-3 py-2 text-right">
                  <span class="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-default">
              <tr v-for="m in movements" :key="m.id">
                <td class="px-3 py-2 whitespace-nowrap text-muted">
                  {{ formatInstantInLima(m.occurredAt) }}
                </td>
                <td class="px-3 py-2">
                  <UBadge
                    :color="TYPE_CONFIG[m.type].color"
                    variant="subtle"
                    size="xs"
                    :label="TYPE_CONFIG[m.type].label"
                  />
                  <p v-if="m.reason" class="mt-0.5 text-[10px] text-muted italic">
                    Motivo: {{ m.reason }}
                  </p>
                </td>
                <td class="px-3 py-2">{{ m.containerTypeName }}</td>
                <td class="px-3 py-2 text-right font-medium tabular-nums">{{ m.quantity }}</td>
                <td class="px-3 py-2 text-right tabular-nums">
                  {{ m.saleTotal ? formatSoles(m.saleTotal) : "—" }}
                </td>
                <td class="px-3 py-2 text-muted">{{ m.recordedByName }}</td>
                <td class="px-3 py-2 text-right">
                  <UButton
                    v-if="canVoid(m)"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    icon="i-lucide-ban"
                    label="Anular"
                    @click="openVoidModal(m)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Modal Recibir -->
    <UModal v-model:open="receiveModalOpen" title="Recibir bidones del cliente">
      <template #body>
        <form class="space-y-4" @submit.prevent="submitReceive">
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
              :items="containerTypes.map((t) => ({ label: t.name, value: t.id }))"
              :disabled="receiveSubmitting"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Cantidad de vacíos dejados" required>
            <UInput
              v-model="receiveQuantity"
              type="number"
              :min="1"
              :step="1"
              :disabled="receiveSubmitting"
              class="w-full"
            />
          </UFormField>

          <div class="flex justify-end gap-2 pt-2">
            <UButton
              color="neutral"
              variant="outline"
              label="Cancelar"
              :disabled="receiveSubmitting"
              @click="receiveModalOpen = false"
            />
            <UButton type="submit" label="Registrar recepción" :loading="receiveSubmitting" />
          </div>
        </form>
      </template>
    </UModal>

    <!-- Modal Devolver -->
    <UModal v-model:open="returnModalOpen" title="Devolver bidones llenos (se lleva el cliente)">
      <template #body>
        <form class="space-y-4" @submit.prevent="submitReturn">
          <UAlert
            v-if="returnError"
            role="alert"
            color="error"
            variant="subtle"
            :title="returnError"
          />

          <div v-if="targetBalance" class="rounded bg-elevated p-3 text-sm space-y-1">
            <p>
              Envase: <span class="font-medium">{{ targetBalance.containerTypeName }}</span>
            </p>
            <p>
              Llenos disponibles para devolver:
              <span class="font-medium tabular-nums">{{ targetBalance.fullToReturn }}</span>
            </p>
            <p>
              Precio unitario de maquila:
              <span
                class="font-medium"
                :class="effectiveUnitPrice ? 'text-highlighted' : 'text-error'"
              >
                {{
                  effectiveUnitPrice
                    ? formatSoles(effectiveUnitPrice)
                    : "Falta el precio de maquila de este cliente"
                }}
              </span>
            </p>
          </div>

          <UAlert
            v-if="targetBalance && !effectiveUnitPrice"
            color="error"
            variant="subtle"
            icon="i-lucide-alert-circle"
            title="Falta el precio de maquila"
            description="No se puede devolver sin precio. Registra el precio de lista o precio pactado en Productos para este tipo de envase."
          />

          <UFormField label="Cantidad que se lleva" required>
            <UInput
              v-model="returnQuantity"
              type="number"
              :min="1"
              :max="targetBalance?.fullToReturn"
              :step="1"
              :disabled="returnSubmitting || !effectiveUnitPrice"
              class="w-full"
            />
          </UFormField>

          <div
            v-if="effectiveUnitPrice"
            class="flex items-center justify-between rounded border border-default p-3 text-sm"
          >
            <span class="text-muted">Total a cobrar por el servicio:</span>
            <span class="font-display text-lg font-semibold tabular-nums text-highlighted">
              {{ formatSoles(returnAmount || "0.00") }}
            </span>
          </div>

          <div v-if="locations.length > 0">
            <UFormField label="Local del cliente (opcional)">
              <USelect
                v-model="returnLocationId"
                :items="locations.map((l) => ({ label: l.name, value: l.id }))"
                :disabled="returnSubmitting"
                class="w-full"
              />
            </UFormField>
          </div>

          <!-- Cobro -->
          <div class="border-t border-default pt-3 space-y-3">
            <div class="flex items-center justify-between">
              <label class="text-sm font-medium text-highlighted">Modalidad de cobro</label>
              <div class="flex gap-2">
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
              </div>
            </div>

            <div v-if="payNow" class="space-y-3 rounded bg-elevated p-3">
              <UFormField label="Medio de pago" required>
                <USelect
                  v-model="returnPaymentMethodId"
                  :items="paymentMethods.map((m) => ({ label: m.name, value: m.id }))"
                  :disabled="returnSubmitting"
                  class="w-full"
                />
              </UFormField>

              <UFormField label="Monto cobrado" required>
                <UInput
                  v-model="returnAmount"
                  inputmode="decimal"
                  :disabled="returnSubmitting"
                  class="w-full"
                >
                  <template #leading><span class="text-sm text-muted">S/</span></template>
                </UInput>
              </UFormField>
            </div>
          </div>

          <div class="flex justify-end gap-2 pt-2">
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
              :disabled="!effectiveUnitPrice"
            />
          </div>
        </form>
      </template>
    </UModal>

    <!-- Modal Anular Movimiento -->
    <UModal v-model:open="voidModalOpen" title="Anular movimiento de maquila">
      <template #body>
        <form class="space-y-4" @submit.prevent="submitVoid">
          <UAlert v-if="voidError" role="alert" color="error" variant="subtle" :title="voidError" />

          <p class="text-sm text-muted">
            La anulación emite un movimiento inverso auditable en el libro. Si anulas una
            devolución, también se anulará la venta y el cobro asociado.
          </p>

          <UFormField label="Motivo de la anulación" required>
            <UInput
              v-model="voidReason"
              placeholder="Ej. Error en la cantidad anotada"
              :disabled="voidSubmitting"
              class="w-full"
            />
          </UFormField>

          <div class="flex justify-end gap-2 pt-2">
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
        </form>
      </template>
    </UModal>
  </SectionCard>
</template>
