<script setup lang="ts">
import { formatInstantInLima, formatSoles } from "@yacco/shared";
import type {
  AccessoryMovementItem,
  AccessoryMovementType,
  AccessoryReconciliationResult,
  AccessorySummary,
  Page,
} from "@yacco/shared";
import type { TableColumn } from "@nuxt/ui";
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

const accessoryColumns: TableColumn<AccessorySummary>[] = [
  { accessorKey: "name", header: "Accesorio" },
  { id: "listPrice", header: "Precio de lista", meta: RIGHT_ALIGNED },
  { id: "stock", header: "En planta", meta: RIGHT_ALIGNED },
  { accessorKey: "totalBorrowed", header: "Prestados", meta: RIGHT_ALIGNED },
  { id: "total", header: "Total", meta: RIGHT_ALIGNED },
  { id: "actions", header: hiddenHeader("Acciones"), meta: RIGHT_ALIGNED },
];
const movementColumns = computed<TableColumn<AccessoryMovementItem>[]>(() => [
  { id: "occurredAt", header: "Fecha" },
  { id: "type", header: "Tipo" },
  { id: "quantity", header: "Cantidad", meta: RIGHT_ALIGNED },
  { id: "detail", header: "Detalle" },
  { accessorKey: "recordedByName", header: "Registrado por" },
  ...(isAdmin.value
    ? [{ id: "actions", header: hiddenHeader("Acciones"), meta: RIGHT_ALIGNED }]
    : []),
]);
const stockDiscrepancyColumns: TableColumn<
  AccessoryReconciliationResult["stockDiscrepancies"][number]
>[] = [
  { accessorKey: "productName", header: "Accesorio" },
  { accessorKey: "materializedStock", header: "Saldo actual", meta: RIGHT_ALIGNED },
  { accessorKey: "ledgerStock", header: "Según libro", meta: RIGHT_ALIGNED },
  { id: "difference", header: "Diferencia", meta: RIGHT_ALIGNED },
];
const balanceDiscrepancyColumns: TableColumn<
  AccessoryReconciliationResult["customerBalanceDiscrepancies"][number]
>[] = [
  { accessorKey: "locationName", header: "Local" },
  { accessorKey: "productName", header: "Accesorio" },
  { accessorKey: "materializedBalance", header: "Saldo actual", meta: RIGHT_ALIGNED },
  { accessorKey: "ledgerBalance", header: "Según libro", meta: RIGHT_ALIGNED },
  { id: "difference", header: "Diferencia", meta: RIGHT_ALIGNED },
];
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

    <UPageBody>
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

      <UCard v-else>
        <UTable
          :data="accessories"
          :columns="accessoryColumns"
          caption="Inventario de accesorios en planta y prestados"
        >
          <template #listPrice-cell="{ row }">{{ formatSoles(row.original.listPrice) }}</template>
          <template #stock-cell="{ row }">
            <!-- En negativo, el sistema entregó más de lo que entró a planta. -->
            <UBadge
              v-if="row.original.stock < 0"
              color="error"
              variant="subtle"
              :label="String(row.original.stock)"
            />
            <template v-else>{{ row.original.stock }}</template>
          </template>
          <template #total-cell="{ row }">
            {{ row.original.stock + row.original.totalBorrowed }}
          </template>
          <template #actions-cell="{ row }">
            <div class="flex justify-end gap-2">
              <template v-if="isAdmin">
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  label="Ingreso"
                  @click="startEntry(row.original)"
                />
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  label="Baja"
                  @click="startWriteOff(row.original)"
                />
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  label="Contar"
                  @click="startCount(row.original)"
                />
              </template>
              <UButton
                color="neutral"
                variant="ghost"
                size="sm"
                label="Movimientos"
                @click="startMovements(row.original)"
              />
            </div>
          </template>
        </UTable>
      </UCard>
    </UPageBody>

    <!-- Modal Ingreso -->
    <UModal v-model:open="entryModalOpen" :title="`Ingreso a planta: ${entryTarget?.name}`">
      <template #body>
        <UForm :state="{}" :validate-on="[]" :loading-auto="false" @submit="submitEntry">
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

          <div class="flex justify-end gap-2">
            <UButton
              color="neutral"
              variant="outline"
              label="Cancelar"
              :disabled="entrySubmitting"
              @click="entryModalOpen = false"
            />
            <UButton type="submit" label="Registrar ingreso" :loading="entrySubmitting" />
          </div>
        </UForm>
      </template>
    </UModal>

    <!-- Modal Baja -->
    <UModal v-model:open="writeOffModalOpen" :title="`Baja en planta: ${writeOffTarget?.name}`">
      <template #body>
        <UForm :state="{}" :validate-on="[]" :loading-auto="false" @submit="submitWriteOff">
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

          <div class="flex justify-end gap-2">
            <UButton
              color="neutral"
              variant="outline"
              label="Cancelar"
              :disabled="writeOffSubmitting"
              @click="writeOffModalOpen = false"
            />
            <UButton type="submit" label="Registrar baja" :loading="writeOffSubmitting" />
          </div>
        </UForm>
      </template>
    </UModal>

    <!-- Modal Conteo -->
    <UModal v-model:open="countModalOpen" :title="`Conteo en planta: ${countTarget?.name}`">
      <template #body>
        <UForm :state="{}" :validate-on="[]" :loading-auto="false" @submit="submitCount">
          <UAlert
            v-if="countError"
            role="alert"
            color="error"
            variant="subtle"
            :title="countError"
          />

          <p>Stock según el sistema: {{ countTarget?.stock }}</p>

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

          <div class="flex justify-end gap-2">
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
        </UForm>
      </template>
    </UModal>

    <!-- Modal Movimientos -->
    <UModal v-model:open="movementsModalOpen" :title="`Movimientos: ${movementsTarget?.name}`">
      <template #body>
        <UPageBody>
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
            <UTable
              :data="movements"
              :columns="movementColumns"
              caption="Movimientos del accesorio"
            >
              <template #occurredAt-cell="{ row }">
                {{ formatInstantInLima(row.original.occurredAt) }}
              </template>
              <template #type-cell="{ row }">
                {{ MOVEMENT_LABELS[row.original.type] ?? row.original.type }}
              </template>
              <template #quantity-cell="{ row }">
                <!-- Lo que sale de planta va en negativo. -->
                <UBadge
                  v-if="row.original.quantity < 0"
                  color="error"
                  variant="subtle"
                  :label="String(row.original.quantity)"
                />
                <template v-else>
                  {{ row.original.quantity > 0 ? `+${row.original.quantity}` : 0 }}
                </template>
              </template>
              <template #detail-cell="{ row }">
                <p v-if="row.original.locationName">
                  {{
                    row.original.customerName
                      ? `${row.original.customerName} · ${row.original.locationName}`
                      : row.original.locationName
                  }}
                </p>
                <p v-if="row.original.reason">{{ row.original.reason }}</p>
                <p v-if="row.original.saleId">Venta #{{ row.original.saleId.slice(0, 8) }}</p>
                <UBadge
                  v-if="row.original.reversesMovementId"
                  color="warning"
                  variant="subtle"
                  size="xs"
                  label="Anulación"
                />
              </template>
              <template #actions-cell="{ row }">
                <UButton
                  v-if="row.original.type === 'LOAN_CHARGE' && !row.original.reversesMovementId"
                  color="error"
                  variant="ghost"
                  size="xs"
                  label="Anular cobro"
                  @click="startVoidCharge(row.original)"
                />
              </template>
            </UTable>

            <ListPagination
              :shown-page="movementsPage"
              :page="movementsPage"
              :total-pages="movementsTotalPages"
              @previous="onMovementsPrevious"
              @next="onMovementsNext"
            />
          </template>
        </UPageBody>
      </template>
    </UModal>

    <!-- Modal Anular Cobro -->
    <UModal v-model:open="voidModalOpen" title="Anular cobro de accesorio">
      <template #body>
        <UForm :state="{}" :validate-on="[]" :loading-auto="false" @submit="submitVoidCharge">
          <UAlert v-if="voidError" role="alert" color="error" variant="subtle" :title="voidError" />

          <p>
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

          <div class="flex justify-end gap-2">
            <UButton
              color="neutral"
              variant="outline"
              label="Cancelar"
              :disabled="voidSubmitting"
              @click="voidModalOpen = false"
            />
            <UButton type="submit" color="error" label="Anular cobro" :loading="voidSubmitting" />
          </div>
        </UForm>
      </template>
    </UModal>

    <!-- Modal Cuadre / Reconciliación -->
    <UModal v-model:open="reconciliationModalOpen" title="Cuadre de accesorios">
      <template #body>
        <UPageBody>
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

            <template v-if="reconciliation.stockDiscrepancies.length > 0">
              <h3>Diferencias en stock de planta</h3>
              <UTable
                :data="reconciliation.stockDiscrepancies"
                :columns="stockDiscrepancyColumns"
                caption="Diferencias en stock de planta"
              >
                <template #difference-cell="{ row }">
                  <UBadge color="error" variant="subtle" :label="String(row.original.difference)" />
                </template>
              </UTable>
            </template>

            <template v-if="reconciliation.customerBalanceDiscrepancies.length > 0">
              <h3>Diferencias en prestados a clientes</h3>
              <UTable
                :data="reconciliation.customerBalanceDiscrepancies"
                :columns="balanceDiscrepancyColumns"
                caption="Diferencias en prestados a clientes"
              >
                <template #difference-cell="{ row }">
                  <UBadge color="error" variant="subtle" :label="String(row.original.difference)" />
                </template>
              </UTable>
            </template>
          </template>
        </UPageBody>
      </template>
    </UModal>
  </AppPage>
</template>
