<script setup lang="ts">
import { formatInstantInLima, formatSoles } from "@yacco/shared";
import type {
  AccessoryMovementItem,
  AccessoryMovementType,
  AccessoryReconciliationResult,
  AccessorySummary,
  Page,
} from "@yacco/shared";
import { positiveWhole } from "../utils/quantity";

useHead({ title: "Accesorios · Yacco" });

const MOVEMENT_LABELS: Record<AccessoryMovementType, string> = {
  ENTRY: "Ingreso a planta",
  SALE: "Venta",
  SALE_VOID: "Anulación de venta",
  LOAN: "Préstamo",
  LOAN_VOID: "Anulación de préstamo",
  LOAN_RETURN: "Devolución",
  LOAN_RETURN_VOID: "Anulación de devolución",
  LOAN_CHARGE: "Cobro de prestado",
  LOAN_CHARGE_VOID: "Anulación de cobro",
  WRITE_OFF: "Baja en planta",
  COUNT_ADJUSTMENT: "Ajuste por conteo",
};

const session = useSession();
const api = useApi();
const isAdmin = computed(() => session.hasRole("ADMIN"));

const accessories = ref<AccessorySummary[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);
const slow = useSlowRequest(loading);

async function loadAccessories(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    accessories.value = await api.request<AccessorySummary[]>("/accessories");
  } catch (error) {
    loadError.value = describeApiFailure(error);
  } finally {
    loading.value = false;
  }
}
onMounted(loadAccessories);

const summary = computed(() => {
  if (loading.value) return "Cargando…";
  const count = accessories.value.length;
  return `${count} ${count === 1 ? "accesorio" : "accesorios"}`;
});

// --- Modal de Ingreso ---
const entryModalOpen = ref(false);
const entryTarget = ref<AccessorySummary | null>(null);
const entryQuantity = ref("");
const entrySubmitting = ref(false);
const entryError = ref<string | null>(null);

function startEntry(accessory: AccessorySummary): void {
  entryTarget.value = accessory;
  entryQuantity.value = "";
  entryError.value = null;
  entryModalOpen.value = true;
}

async function submitEntry(): Promise<void> {
  if (entrySubmitting.value || !entryTarget.value) return;
  const qty = positiveWhole(entryQuantity.value);
  if (qty === null) {
    entryError.value = "La cantidad debe ser un número entero mayor que 0";
    return;
  }
  entrySubmitting.value = true;
  entryError.value = null;
  try {
    await api.request(`/accessories/${entryTarget.value.id}/entries`, {
      method: "POST",
      body: { quantity: qty },
    });
    entryModalOpen.value = false;
    await loadAccessories();
  } catch (error) {
    entryError.value = describeApiFailure(error);
  } finally {
    entrySubmitting.value = false;
  }
}

// --- Modal de Baja ---
const writeOffModalOpen = ref(false);
const writeOffTarget = ref<AccessorySummary | null>(null);
const writeOffQuantity = ref("");
const writeOffReason = ref("");
const writeOffSubmitting = ref(false);
const writeOffError = ref<string | null>(null);

function startWriteOff(accessory: AccessorySummary): void {
  writeOffTarget.value = accessory;
  writeOffQuantity.value = "";
  writeOffReason.value = "";
  writeOffError.value = null;
  writeOffModalOpen.value = true;
}

async function submitWriteOff(): Promise<void> {
  if (writeOffSubmitting.value || !writeOffTarget.value) return;
  const qty = positiveWhole(writeOffQuantity.value);
  if (qty === null) {
    writeOffError.value = "La cantidad debe ser un número entero mayor que 0";
    return;
  }
  const reason = writeOffReason.value.trim();
  if (!reason) {
    writeOffError.value = "Debes indicar el motivo de la baja";
    return;
  }
  writeOffSubmitting.value = true;
  writeOffError.value = null;
  try {
    await api.request(`/accessories/${writeOffTarget.value.id}/write-offs`, {
      method: "POST",
      body: { quantity: qty, reason },
    });
    writeOffModalOpen.value = false;
    await loadAccessories();
  } catch (error) {
    writeOffError.value = describeApiFailure(error);
  } finally {
    writeOffSubmitting.value = false;
  }
}

// --- Modal de Conteo ---
const countModalOpen = ref(false);
const countTarget = ref<AccessorySummary | null>(null);
const countQuantity = ref("");
const countReason = ref("");
const countSubmitting = ref(false);
const countError = ref<string | null>(null);

function startCount(accessory: AccessorySummary): void {
  countTarget.value = accessory;
  countQuantity.value = "";
  countReason.value = "";
  countError.value = null;
  countModalOpen.value = true;
}

const parsedCountQty = computed(() => {
  const trimmed = String(countQuantity.value ?? "").trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
});

const countHasDifference = computed(() => {
  if (countTarget.value === null || parsedCountQty.value === null) return false;
  return parsedCountQty.value !== countTarget.value.stock;
});

async function submitCount(): Promise<void> {
  if (countSubmitting.value || !countTarget.value) return;
  const qty = parsedCountQty.value;
  if (qty === null || qty < 0) {
    countError.value = "Lo contado debe ser un número entero, 0 o más";
    return;
  }
  const reason = countReason.value.trim();
  if (countHasDifference.value && !reason) {
    countError.value = "Debes indicar el motivo de la diferencia";
    return;
  }
  countSubmitting.value = true;
  countError.value = null;
  try {
    await api.request(`/accessories/${countTarget.value.id}/count`, {
      method: "POST",
      body: { countedQuantity: qty, reason: reason || undefined },
    });
    countModalOpen.value = false;
    await loadAccessories();
  } catch (error) {
    countError.value = describeApiFailure(error);
  } finally {
    countSubmitting.value = false;
  }
}

// --- Modal de Movimientos ---
const movementsModalOpen = ref(false);
const movementsTarget = ref<AccessorySummary | null>(null);
const movements = ref<AccessoryMovementItem[]>([]);
const movementsLoading = ref(false);
const movementsError = ref<string | null>(null);
const movementsPage = ref(1);
const movementsTotalPages = ref(1);

async function loadMovements(): Promise<void> {
  if (!movementsTarget.value) return;
  movementsLoading.value = true;
  movementsError.value = null;
  try {
    const res = await api.request<Page<AccessoryMovementItem>>(
      `/accessories/${movementsTarget.value.id}/movements`,
      {
        query: { page: movementsPage.value, limit: 10 },
      },
    );
    movements.value = res.data;
    movementsTotalPages.value = res.totalPages;
  } catch (error) {
    movementsError.value = describeApiFailure(error);
  } finally {
    movementsLoading.value = false;
  }
}

function startMovements(accessory: AccessorySummary): void {
  movementsTarget.value = accessory;
  movementsPage.value = 1;
  movementsModalOpen.value = true;
  void loadMovements();
}

function onMovementsPrevious(): void {
  if (movementsPage.value > 1) {
    movementsPage.value--;
    void loadMovements();
  }
}

function onMovementsNext(): void {
  if (movementsPage.value < movementsTotalPages.value) {
    movementsPage.value++;
    void loadMovements();
  }
}

// --- Anular Cobro desde Movimientos ---
const voidModalOpen = ref(false);
const voidTargetMovement = ref<AccessoryMovementItem | null>(null);
const voidReason = ref("");
const voidSubmitting = ref(false);
const voidError = ref<string | null>(null);

function startVoidCharge(movement: AccessoryMovementItem): void {
  voidTargetMovement.value = movement;
  voidReason.value = "";
  voidError.value = null;
  voidModalOpen.value = true;
}

async function submitVoidCharge(): Promise<void> {
  if (voidSubmitting.value || !voidTargetMovement.value) return;
  const reason = voidReason.value.trim();
  if (!reason) {
    voidError.value = "Debes indicar el motivo de la anulación";
    return;
  }
  voidSubmitting.value = true;
  voidError.value = null;
  try {
    await api.request(`/accessories/movements/${voidTargetMovement.value.id}/void`, {
      method: "POST",
      body: { reason },
    });
    voidModalOpen.value = false;
    await loadMovements();
    await loadAccessories();
  } catch (error) {
    voidError.value = describeApiFailure(error);
  } finally {
    voidSubmitting.value = false;
  }
}

// --- Modal de Cuadre / Reconciliación ---
const reconciliationModalOpen = ref(false);
const reconciliation = ref<AccessoryReconciliationResult | null>(null);
const reconciliationLoading = ref(false);
const reconciliationError = ref<string | null>(null);

async function loadReconciliation(): Promise<void> {
  reconciliationLoading.value = true;
  reconciliationError.value = null;
  try {
    reconciliation.value = await api.request<AccessoryReconciliationResult>(
      "/accessories/reconciliation",
    );
  } catch (error) {
    reconciliationError.value = describeApiFailure(error);
  } finally {
    reconciliationLoading.value = false;
  }
}

function startReconciliation(): void {
  reconciliationModalOpen.value = true;
  void loadReconciliation();
}
</script>

<template>
  <AppPage title="Accesorios" :description="summary">
    <template v-if="isAdmin" #actions>
      <UButton
        color="neutral"
        variant="outline"
        icon="i-lucide-scale"
        label="Cuadre de accesorios"
        @click="startReconciliation"
      />
    </template>

    <div class="space-y-6">
      <UAlert
        v-if="slow && loading"
        role="status"
        color="neutral"
        variant="subtle"
        :title="SLOW_REQUEST_MESSAGE"
      />

      <ListStatus
        v-if="loadError || loading || accessories.length === 0"
        :error-message="loadError"
        :loading="loading"
        :empty="accessories.length === 0"
        loading-label="Cargando accesorios…"
        empty-icon="i-lucide-wrench"
        empty-title="Todavía no hay accesorios"
        empty-description="Registra accesorios en la pantalla de Productos para empezar a controlar su stock."
        @retry="loadAccessories"
      />

      <UCard v-else :ui="{ body: 'p-0 sm:p-0' }">
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <caption class="sr-only">
              Inventario de accesorios en planta y prestados
            </caption>
            <thead class="bg-elevated text-left text-xs tracking-wide text-muted uppercase">
              <tr>
                <th scope="col" class="px-4 py-3 font-medium">Accesorio</th>
                <th scope="col" class="px-4 py-3 text-right font-medium">Precio de lista</th>
                <th scope="col" class="px-4 py-3 text-right font-medium">En planta</th>
                <th scope="col" class="px-4 py-3 text-right font-medium">Prestados</th>
                <th scope="col" class="px-4 py-3 text-right font-medium">Total</th>
                <th scope="col" class="px-4 py-3 text-right font-medium">
                  <span class="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-default">
              <tr v-for="item in accessories" :key="item.id">
                <td class="px-4 py-3 font-medium text-highlighted">
                  {{ item.name }}
                </td>
                <td class="px-4 py-3 text-right tabular-nums">
                  {{ formatSoles(item.listPrice) }}
                </td>
                <td
                  class="px-4 py-3 text-right font-medium tabular-nums"
                  :class="item.stock < 0 ? 'text-error' : 'text-highlighted'"
                >
                  {{ item.stock }}
                </td>
                <td class="px-4 py-3 text-right tabular-nums">
                  {{ item.totalBorrowed }}
                </td>
                <td class="px-4 py-3 text-right font-semibold tabular-nums">
                  {{ item.stock + item.totalBorrowed }}
                </td>
                <td class="px-4 py-3 text-right">
                  <div class="flex justify-end gap-1">
                    <template v-if="isAdmin">
                      <UButton
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        label="Ingreso"
                        @click="startEntry(item)"
                      />
                      <UButton
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        label="Baja"
                        @click="startWriteOff(item)"
                      />
                      <UButton
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        label="Contar"
                        @click="startCount(item)"
                      />
                    </template>
                    <UButton
                      color="neutral"
                      variant="ghost"
                      size="sm"
                      label="Movimientos"
                      @click="startMovements(item)"
                    />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UCard>
    </div>

    <!-- Modal Ingreso -->
    <UModal v-model:open="entryModalOpen" :title="`Ingreso a planta: ${entryTarget?.name}`">
      <template #body>
        <form class="space-y-4" @submit.prevent="submitEntry">
          <UAlert
            v-if="entryError"
            role="alert"
            color="error"
            variant="subtle"
            :title="entryError"
          />

          <UFormField label="Cantidad que entra a planta" required>
            <UInput
              v-model="entryQuantity"
              type="number"
              min="1"
              step="1"
              placeholder="Ej. 10"
              :disabled="entrySubmitting"
              class="w-full"
            />
          </UFormField>

          <div class="flex justify-end gap-2 pt-2">
            <UButton
              color="neutral"
              variant="outline"
              label="Cancelar"
              :disabled="entrySubmitting"
              @click="entryModalOpen = false"
            />
            <UButton type="submit" label="Registrar ingreso" :loading="entrySubmitting" />
          </div>
        </form>
      </template>
    </UModal>

    <!-- Modal Baja -->
    <UModal v-model:open="writeOffModalOpen" :title="`Baja en planta: ${writeOffTarget?.name}`">
      <template #body>
        <form class="space-y-4" @submit.prevent="submitWriteOff">
          <UAlert
            v-if="writeOffError"
            role="alert"
            color="error"
            variant="subtle"
            :title="writeOffError"
          />

          <UFormField label="Cantidad que se da de baja" required>
            <UInput
              v-model="writeOffQuantity"
              type="number"
              min="1"
              step="1"
              placeholder="Ej. 2"
              :disabled="writeOffSubmitting"
              class="w-full"
            />
          </UFormField>

          <UFormField
            label="Motivo de la baja"
            required
            help="Ej. Roto en galpón, falla de fábrica o extravío"
          >
            <UInput
              v-model="writeOffReason"
              placeholder="Motivo de la baja"
              :disabled="writeOffSubmitting"
              class="w-full"
            />
          </UFormField>

          <div class="flex justify-end gap-2 pt-2">
            <UButton
              color="neutral"
              variant="outline"
              label="Cancelar"
              :disabled="writeOffSubmitting"
              @click="writeOffModalOpen = false"
            />
            <UButton type="submit" label="Registrar baja" :loading="writeOffSubmitting" />
          </div>
        </form>
      </template>
    </UModal>

    <!-- Modal Conteo -->
    <UModal v-model:open="countModalOpen" :title="`Conteo en planta: ${countTarget?.name}`">
      <template #body>
        <form class="space-y-4" @submit.prevent="submitCount">
          <UAlert
            v-if="countError"
            role="alert"
            color="error"
            variant="subtle"
            :title="countError"
          />

          <p class="text-sm text-muted">
            Stock según el sistema:
            <span class="font-medium text-highlighted tabular-nums">{{ countTarget?.stock }}</span>
          </p>

          <UFormField label="Cantidad contada físicamente" required>
            <UInput
              v-model="countQuantity"
              type="number"
              min="0"
              step="1"
              placeholder="Ej. 10"
              :disabled="countSubmitting"
              class="w-full"
            />
          </UFormField>

          <UAlert
            v-if="countHasDifference"
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            :title="`Diferencia de conteo: según el sistema ${countTarget?.stock}, contado ${parsedCountQty} (diferencia ${(parsedCountQty ?? 0) - (countTarget?.stock ?? 0)}).`"
          />

          <UFormField
            v-if="countHasDifference"
            label="Motivo del ajuste"
            required
            help="Indica por qué difiere lo contado de lo esperado"
          >
            <UInput
              v-model="countReason"
              placeholder="Ej. Faltante detectado en revisión"
              :disabled="countSubmitting"
              class="w-full"
            />
          </UFormField>

          <div class="flex justify-end gap-2 pt-2">
            <UButton
              color="neutral"
              variant="outline"
              label="Cancelar"
              :disabled="countSubmitting"
              @click="countModalOpen = false"
            />
            <UButton
              type="submit"
              :label="countHasDifference ? 'Confirmar diferencia' : 'Registrar conteo'"
              :loading="countSubmitting"
            />
          </div>
        </form>
      </template>
    </UModal>

    <!-- Modal Movimientos -->
    <UModal
      v-model:open="movementsModalOpen"
      :title="`Movimientos: ${movementsTarget?.name}`"
      :ui="{ content: 'sm:max-w-4xl' }"
    >
      <template #body>
        <div class="space-y-4">
          <ListStatus
            v-if="movementsError || movementsLoading || movements.length === 0"
            :error-message="movementsError"
            :loading="movementsLoading"
            :empty="movements.length === 0"
            loading-label="Cargando movimientos…"
            empty-icon="i-lucide-package-search"
            empty-title="Sin movimientos"
            empty-description="Todavía no hay movimientos registrados para este accesorio."
            @retry="loadMovements"
          />

          <template v-else>
            <div class="overflow-x-auto rounded-md border border-default">
              <table class="w-full text-sm">
                <caption class="sr-only">
                  Movimientos del accesorio
                </caption>
                <thead class="bg-elevated text-left text-xs tracking-wide text-muted uppercase">
                  <tr>
                    <th scope="col" class="px-3 py-2 font-medium">Fecha</th>
                    <th scope="col" class="px-3 py-2 font-medium">Tipo</th>
                    <th scope="col" class="px-3 py-2 text-right font-medium">Cantidad</th>
                    <th scope="col" class="px-3 py-2 font-medium">Detalle</th>
                    <th scope="col" class="px-3 py-2 font-medium">Registrado por</th>
                    <th v-if="isAdmin" scope="col" class="px-3 py-2 text-right font-medium">
                      <span class="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-default">
                  <tr v-for="m in movements" :key="m.id">
                    <td class="px-3 py-2 text-muted tabular-nums whitespace-nowrap">
                      {{ formatInstantInLima(m.occurredAt) }}
                    </td>
                    <td class="px-3 py-2 font-medium">
                      {{ MOVEMENT_LABELS[m.type] ?? m.type }}
                    </td>
                    <td
                      class="px-3 py-2 text-right font-semibold tabular-nums"
                      :class="m.quantity < 0 ? 'text-error' : 'text-highlighted'"
                    >
                      {{ m.quantity > 0 ? `+${m.quantity}` : m.quantity }}
                    </td>
                    <td class="px-3 py-2 text-muted text-xs">
                      <div v-if="m.locationName">
                        {{
                          m.customerName ? `${m.customerName} · ${m.locationName}` : m.locationName
                        }}
                      </div>
                      <div v-if="m.reason">
                        {{ m.reason }}
                      </div>
                      <div v-if="m.saleId" class="tabular-nums">
                        Venta #{{ m.saleId.slice(0, 8) }}
                      </div>
                      <UBadge
                        v-if="m.reversesMovementId"
                        color="warning"
                        variant="subtle"
                        size="xs"
                        label="Anulación"
                      />
                    </td>
                    <td class="px-3 py-2 text-muted">
                      {{ m.recordedByName }}
                    </td>
                    <td v-if="isAdmin" class="px-3 py-2 text-right">
                      <UButton
                        v-if="m.type === 'LOAN_CHARGE' && !m.reversesMovementId"
                        color="error"
                        variant="ghost"
                        size="xs"
                        label="Anular cobro"
                        @click="startVoidCharge(m)"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <ListPagination
              :shown-page="movementsPage"
              :page="movementsPage"
              :total-pages="movementsTotalPages"
              @previous="onMovementsPrevious"
              @next="onMovementsNext"
            />
          </template>
        </div>
      </template>
    </UModal>

    <!-- Modal Anular Cobro -->
    <UModal v-model:open="voidModalOpen" title="Anular cobro de accesorio">
      <template #body>
        <form class="space-y-4" @submit.prevent="submitVoidCharge">
          <UAlert v-if="voidError" role="alert" color="error" variant="subtle" :title="voidError" />

          <p class="text-sm text-muted">
            Anular este cobro devolverá el accesorio al saldo de prestados del cliente y cancelará
            la venta asociada.
          </p>

          <UFormField label="Motivo de la anulación" required>
            <UInput
              v-model="voidReason"
              placeholder="Ej. Error de digitación, cliente encontró el surtidor"
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
            <UButton type="submit" color="error" label="Anular cobro" :loading="voidSubmitting" />
          </div>
        </form>
      </template>
    </UModal>

    <!-- Modal Cuadre / Reconciliación -->
    <UModal
      v-model:open="reconciliationModalOpen"
      title="Cuadre de accesorios"
      :ui="{ content: 'sm:max-w-3xl' }"
    >
      <template #body>
        <div class="space-y-4">
          <ListStatus
            v-if="reconciliationError || reconciliationLoading"
            :error-message="reconciliationError"
            :loading="reconciliationLoading"
            :empty="false"
            loading-label="Calculando cuadre de accesorios contra el libro…"
            empty-icon=""
            empty-title=""
            empty-description=""
            @retry="loadReconciliation"
          />

          <template v-else-if="reconciliation">
            <UAlert
              v-if="reconciliation.isBalanced"
              role="status"
              color="success"
              variant="subtle"
              icon="i-lucide-circle-check"
              title="El libro de movimientos y los saldos de accesorios coinciden exactamente."
            />
            <UAlert
              v-else
              role="alert"
              color="warning"
              variant="subtle"
              icon="i-lucide-triangle-alert"
              title="Hay diferencias entre el libro de movimientos y los saldos materializados."
            />

            <!-- Discrepancias en stock de planta -->
            <div v-if="reconciliation.stockDiscrepancies.length > 0" class="space-y-2">
              <h3 class="font-medium text-sm text-highlighted">Diferencias en stock de planta</h3>
              <div class="overflow-x-auto rounded-md border border-default">
                <table class="w-full text-sm">
                  <thead class="bg-elevated text-left text-xs uppercase text-muted">
                    <tr>
                      <th class="px-3 py-2">Accesorio</th>
                      <th class="px-3 py-2 text-right">Saldo actual</th>
                      <th class="px-3 py-2 text-right">Según libro</th>
                      <th class="px-3 py-2 text-right">Diferencia</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-default">
                    <tr v-for="d in reconciliation.stockDiscrepancies" :key="d.productId">
                      <td class="px-3 py-2 font-medium">{{ d.productName }}</td>
                      <td class="px-3 py-2 text-right tabular-nums">{{ d.materializedStock }}</td>
                      <td class="px-3 py-2 text-right tabular-nums">{{ d.ledgerStock }}</td>
                      <td class="px-3 py-2 text-right tabular-nums font-semibold text-error">
                        {{ d.difference }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Discrepancias en saldos de clientes -->
            <div v-if="reconciliation.customerBalanceDiscrepancies.length > 0" class="space-y-2">
              <h3 class="font-medium text-sm text-highlighted">
                Diferencias en prestados a clientes
              </h3>
              <div class="overflow-x-auto rounded-md border border-default">
                <table class="w-full text-sm">
                  <thead class="bg-elevated text-left text-xs uppercase text-muted">
                    <tr>
                      <th class="px-3 py-2">Local</th>
                      <th class="px-3 py-2">Accesorio</th>
                      <th class="px-3 py-2 text-right">Saldo actual</th>
                      <th class="px-3 py-2 text-right">Según libro</th>
                      <th class="px-3 py-2 text-right">Diferencia</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-default">
                    <tr
                      v-for="d in reconciliation.customerBalanceDiscrepancies"
                      :key="`${d.locationId}-${d.productId}`"
                    >
                      <td class="px-3 py-2 font-medium">{{ d.locationName }}</td>
                      <td class="px-3 py-2">{{ d.productName }}</td>
                      <td class="px-3 py-2 text-right tabular-nums">{{ d.materializedBalance }}</td>
                      <td class="px-3 py-2 text-right tabular-nums">{{ d.ledgerBalance }}</td>
                      <td class="px-3 py-2 text-right tabular-nums font-semibold text-error">
                        {{ d.difference }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </template>
        </div>
      </template>
    </UModal>
  </AppPage>
</template>
