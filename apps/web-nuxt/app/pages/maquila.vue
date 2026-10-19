<script setup lang="ts">
import { formatInstantInLima, formatSoles } from "@yacco/shared";
import type {
  MaquilaCustomerSummary,
  MaquilaMovementItem,
  MaquilaMovementType,
  MaquilaReconciliationResult,
  PaginatedMaquilaMovements,
} from "@yacco/shared";
import type { TableColumn } from "@nuxt/ui";

useHead({ title: "Maquila · Yacco" });

const session = useSession();
const api = useApi();
const isAdmin = computed(() => session.hasRole("ADMIN"));
const canVoidFilled = computed(
  () => session.hasRole("ADMIN") || session.hasRole("PLANT_SUPERVISOR"),
);

const customers = ref<MaquilaCustomerSummary[]>([]);
const movements = ref<MaquilaMovementItem[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);
const slow = useSlowRequest(loading);

const customerFilter = ref("");

async function loadData(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    const [custs, movs] = await Promise.all([
      api.request<MaquilaCustomerSummary[]>("/maquila/customers"),
      api.request<PaginatedMaquilaMovements>("/maquila/movements", {
        query: { limit: 50 },
      }),
    ]);
    customers.value = custs;
    movements.value = movs.data;
  } catch (error) {
    loadError.value = describeApiFailure(error);
  } finally {
    loading.value = false;
  }
}
onMounted(loadData);

const filteredCustomers = computed(() => {
  const query = customerFilter.value.trim().toLowerCase();
  if (!query) return customers.value;
  return customers.value.filter((c) => c.customerName.toLowerCase().includes(query));
});

const totalEmptyAtPlant = computed(() =>
  customers.value.reduce((acc, c) => acc + c.emptyAtPlantTotal, 0),
);

const totalFullToReturn = computed(() =>
  customers.value.reduce((acc, c) => acc + c.fullToReturnTotal, 0),
);

const summary = computed(() => {
  if (loading.value) return "Cargando…";
  const count = customers.value.length;
  return `${count} ${count === 1 ? "cliente con bidones" : "clientes con bidones"} en la planta`;
});

// --- Cuadre de maquila ---
const reconciliationModalOpen = ref(false);
const reconciling = ref(false);
const reconciliationResult = ref<MaquilaReconciliationResult | null>(null);
const reconciliationError = ref<string | null>(null);

async function runReconciliation(): Promise<void> {
  if (reconciling.value) return;
  reconciling.value = true;
  reconciliationError.value = null;
  reconciliationModalOpen.value = true;
  try {
    reconciliationResult.value =
      await api.request<MaquilaReconciliationResult>("/maquila/reconciliation");
  } catch (error) {
    reconciliationError.value = describeApiFailure(error);
  } finally {
    reconciling.value = false;
  }
}

// --- Anular movimiento ---
const { openVoidModal, submitVoid, voidError, voidModalOpen, voidReason, voidSubmitting } =
  useMaquilaVoid(loadData);

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
  const isReversed = movements.value.some((m) => m.reversesMovementId === mov.id);
  if (isReversed) return false;

  if (mov.type === "FILLED") return canVoidFilled.value;
  if (mov.type === "RECEIVED" || mov.type === "RETURNED") return isAdmin.value;
  return false;
}

const customerColumns: TableColumn<MaquilaCustomerSummary>[] = [
  { id: "customer", header: "Cliente" },
  { id: "emptyAtPlant", header: "Vacíos en planta", meta: RIGHT_ALIGNED },
  { id: "fullToReturn", header: "Llenos por devolver", meta: RIGHT_ALIGNED },
  { id: "balances", header: "Desglose por tipo" },
  { id: "actions", header: hiddenHeader("Acciones"), meta: RIGHT_ALIGNED },
];
const movementColumns: TableColumn<MaquilaMovementItem>[] = [
  { id: "occurredAt", header: "Fecha" },
  { id: "customer", header: "Cliente" },
  { id: "type", header: "Tipo" },
  { accessorKey: "containerTypeName", header: "Envase" },
  { accessorKey: "quantity", header: "Cant.", meta: RIGHT_ALIGNED },
  { id: "saleTotal", header: "Cargo S/", meta: RIGHT_ALIGNED },
  { accessorKey: "recordedByName", header: "Registrado por" },
  { id: "actions", header: hiddenHeader("Acciones"), meta: RIGHT_ALIGNED },
];
const discrepancyColumns: TableColumn<MaquilaReconciliationResult["discrepancies"][number]>[] = [
  { accessorKey: "customerName", header: "Cliente" },
  { accessorKey: "containerTypeName", header: "Envase" },
  { id: "emptyCounts", header: "Vacíos Saldo / Libro", meta: RIGHT_ALIGNED },
  { id: "fullCounts", header: "Llenos Saldo / Libro", meta: RIGHT_ALIGNED },
];
</script>

<template>
  <AppPage title="Maquila" :description="summary">
    <template #actions>
      <UButton
        to="/customers"
        color="neutral"
        variant="outline"
        icon="i-lucide-users"
        label="Todos los clientes"
      />
      <UButton
        v-if="isAdmin"
        color="neutral"
        variant="outline"
        icon="i-lucide-scale"
        label="Cuadre de maquila"
        :loading="reconciling"
        @click="runReconciliation"
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
        v-if="loadError || loading || customers.length === 0"
        :error-message="loadError"
        :loading="loading"
        :empty="customers.length === 0"
        loading-label="Cargando datos de maquila…"
        empty-icon="i-lucide-boxes"
        empty-title="No hay bidones de clientes en la planta"
        empty-description="Cuando un cliente deje envases vacíos, su saldo aparecerá aquí."
        @retry="loadData"
      />

      <template v-else>
        <!-- Resumen numérico -->
        <UPageGrid>
          <StatTile
            label="Clientes con bidones"
            :value="customers.length"
            note="Con al menos un envase en planta"
          />
          <StatTile
            label="Vacíos en planta"
            :value="totalEmptyAtPlant"
            note="Esperando ser llenados"
          />
          <StatTile
            label="Llenos por devolver"
            :value="totalFullToReturn"
            note="Listos para que el cliente se los lleve"
          />
        </UPageGrid>

        <!-- Tabla de clientes -->
        <SectionCard
          title="Clientes con bidones en planta"
          description="Detalle por cliente de envases vacíos y llenos disponibles."
        >
          <UPageBody>
            <UInput v-model="customerFilter" placeholder="Buscar cliente…" icon="i-lucide-search" />

            <!-- Sin filas, UTable pone su propio texto de vacío; antes la tabla quedaba sin filas, sin texto. -->
            <UTable
              v-if="filteredCustomers.length > 0"
              :data="filteredCustomers"
              :columns="customerColumns"
              caption="Clientes con bidones en planta, con vacíos y llenos por tipo de envase"
            >
              <template #customer-cell="{ row }">
                <ULink :to="`/customers/${row.original.customerId}`">
                  {{ row.original.customerName }}
                </ULink>
              </template>
              <template #emptyAtPlant-cell="{ row }">
                <UBadge
                  :color="row.original.emptyAtPlantTotal > 0 ? 'info' : 'neutral'"
                  variant="subtle"
                  :label="String(row.original.emptyAtPlantTotal)"
                />
              </template>
              <template #fullToReturn-cell="{ row }">
                <UBadge
                  :color="row.original.fullToReturnTotal > 0 ? 'success' : 'neutral'"
                  variant="subtle"
                  :label="String(row.original.fullToReturnTotal)"
                />
              </template>
              <template #balances-cell="{ row }">
                <div class="flex flex-wrap items-center gap-2">
                  <UBadge
                    v-for="b in row.original.balances"
                    :key="b.containerTypeId"
                    color="neutral"
                    variant="soft"
                    :label="`${b.containerTypeName}: ${b.emptyAtPlant} vacíos, ${b.fullToReturn} llenos`"
                  />
                </div>
              </template>
              <template #actions-cell="{ row }">
                <UButton
                  :to="`/customers/${row.original.customerId}`"
                  size="xs"
                  color="neutral"
                  variant="outline"
                  label="Ver ficha"
                />
              </template>
            </UTable>
          </UPageBody>
        </SectionCard>

        <!-- Movimientos recientes -->
        <SectionCard
          title="Movimientos recientes de maquila"
          description="Auditoría inmutable de recepciones, llenados y devoluciones."
        >
          <UTable
            v-if="movements.length > 0"
            :data="movements"
            :columns="movementColumns"
            caption="Movimientos recientes de maquila"
          >
            <template #occurredAt-cell="{ row }">
              {{ formatInstantInLima(row.original.occurredAt) }}
            </template>
            <template #customer-cell="{ row }">
              <ULink :to="`/customers/${row.original.customerId}`">
                {{ row.original.customerName }}
              </ULink>
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
        </SectionCard>
      </template>
    </UPageBody>

    <!-- Modal Cuadre de Maquila -->
    <UModal v-model:open="reconciliationModalOpen" title="Cuadre de maquila">
      <template #body>
        <UPageBody>
          <p v-if="reconciling">Corriendo cuadre contra el libro…</p>
          <UAlert
            v-else-if="reconciliationError"
            role="alert"
            color="error"
            variant="subtle"
            :title="reconciliationError"
          />
          <template v-else-if="reconciliationResult">
            <UAlert
              v-if="reconciliationResult.isBalanced"
              color="success"
              variant="subtle"
              icon="i-lucide-check-circle"
              title="Cuadre exacto"
              description="Los saldos materializados coinciden exactamente con la reconstrucción del libro inmutable de maquila."
            />
            <template v-else>
              <UAlert
                color="error"
                variant="subtle"
                icon="i-lucide-alert-triangle"
                title="Descuadre detectado"
                description="Se encontraron diferencias entre los saldos materializados y el libro de movimientos."
              />
              <UTable
                :data="reconciliationResult.discrepancies"
                :columns="discrepancyColumns"
                caption="Saldos de maquila que no coinciden con el libro de movimientos"
              >
                <template #emptyCounts-cell="{ row }">
                  {{ row.original.bookEmpty }} / {{ row.original.ledgerEmpty }}
                </template>
                <template #fullCounts-cell="{ row }">
                  {{ row.original.bookFull }} / {{ row.original.ledgerFull }}
                </template>
              </UTable>
            </template>
          </template>
          <div class="flex justify-end gap-2">
            <UButton
              color="neutral"
              variant="outline"
              label="Cerrar"
              @click="reconciliationModalOpen = false"
            />
          </div>
        </UPageBody>
      </template>
    </UModal>

    <!-- Modal Anular Movimiento -->
    <UModal v-model:open="voidModalOpen" title="Anular movimiento de maquila">
      <template #body>
        <UForm :state="{}" :validate-on="[]" :loading-auto="false" @submit="submitVoid">
          <UAlert v-if="voidError" role="alert" color="error" variant="subtle" :title="voidError" />

          <p>
            La anulación emite un movimiento inverso en el libro. Si anulas una devolución, se
            anulará también la venta y el cobro asociado.
          </p>

          <UFormField label="Motivo de la anulación" required>
            <UInput
              v-model="voidReason"
              placeholder="Ej. Cantidad anotada por error"
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
  </AppPage>
</template>
