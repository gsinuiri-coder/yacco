<script setup lang="ts">
import { formatInstantInLima, formatSoles } from "@yacco/shared";
import type {
  MaquilaCustomerSummary,
  MaquilaMovementItem,
  MaquilaMovementType,
  MaquilaReconciliationResult,
  PaginatedMaquilaMovements,
} from "@yacco/shared";

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

    <div class="space-y-6">
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
        <div class="grid gap-4 sm:grid-cols-3">
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
        </div>

        <!-- Tabla de clientes -->
        <SectionCard
          title="Clientes con bidones en planta"
          description="Detalle por cliente de envases vacíos y llenos disponibles."
        >
          <div class="space-y-4">
            <div class="max-w-xs">
              <UInput
                v-model="customerFilter"
                placeholder="Buscar cliente…"
                icon="i-lucide-search"
                class="w-full"
              />
            </div>

            <div class="overflow-x-auto">
              <table class="w-full text-left text-sm">
                <thead class="bg-elevated text-xs tracking-wide text-muted uppercase">
                  <tr>
                    <th scope="col" class="px-4 py-3 font-medium">Cliente</th>
                    <th scope="col" class="px-4 py-3 text-right font-medium">Vacíos en planta</th>
                    <th scope="col" class="px-4 py-3 text-right font-medium">
                      Llenos por devolver
                    </th>
                    <th scope="col" class="px-4 py-3 font-medium">Desglose por tipo</th>
                    <th scope="col" class="px-4 py-3 text-right">
                      <span class="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-default">
                  <tr v-for="c in filteredCustomers" :key="c.customerId">
                    <td class="px-4 py-3 font-medium text-highlighted">
                      <NuxtLink
                        :to="`/customers/${c.customerId}`"
                        class="hover:underline focus:outline-hidden"
                      >
                        {{ c.customerName }}
                      </NuxtLink>
                    </td>
                    <td class="px-4 py-3 text-right tabular-nums">
                      <UBadge
                        :color="c.emptyAtPlantTotal > 0 ? 'info' : 'neutral'"
                        variant="subtle"
                        :label="String(c.emptyAtPlantTotal)"
                      />
                    </td>
                    <td class="px-4 py-3 text-right tabular-nums">
                      <UBadge
                        :color="c.fullToReturnTotal > 0 ? 'success' : 'neutral'"
                        variant="subtle"
                        :label="String(c.fullToReturnTotal)"
                      />
                    </td>
                    <td class="px-4 py-3">
                      <div class="flex flex-wrap gap-2 text-xs">
                        <span
                          v-for="b in c.balances"
                          :key="b.containerTypeId"
                          class="rounded bg-elevated px-2 py-0.5"
                        >
                          {{ b.containerTypeName }}: {{ b.emptyAtPlant }} vacíos,
                          {{ b.fullToReturn }} llenos
                        </span>
                      </div>
                    </td>
                    <td class="px-4 py-3 text-right">
                      <UButton
                        :to="`/customers/${c.customerId}`"
                        size="xs"
                        color="neutral"
                        variant="outline"
                        label="Ver ficha"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </SectionCard>

        <!-- Movimientos recientes -->
        <SectionCard
          title="Movimientos recientes de maquila"
          description="Auditoría inmutable de recepciones, llenados y devoluciones."
        >
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <thead class="bg-elevated text-muted uppercase">
                <tr>
                  <th scope="col" class="px-3 py-2 font-medium">Fecha</th>
                  <th scope="col" class="px-3 py-2 font-medium">Cliente</th>
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
                  <td class="px-3 py-2 font-medium text-highlighted">
                    <NuxtLink :to="`/customers/${m.customerId}`" class="hover:underline">
                      {{ m.customerName }}
                    </NuxtLink>
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
        </SectionCard>
      </template>
    </div>

    <!-- Modal Cuadre de Maquila -->
    <UModal v-model:open="reconciliationModalOpen" title="Cuadre de maquila">
      <template #body>
        <div class="space-y-4">
          <p v-if="reconciling" class="text-sm text-muted">Corriendo cuadre contra el libro…</p>
          <UAlert
            v-else-if="reconciliationError"
            role="alert"
            color="error"
            variant="subtle"
            :title="reconciliationError"
          />
          <div v-else-if="reconciliationResult">
            <UAlert
              v-if="reconciliationResult.isBalanced"
              color="success"
              variant="subtle"
              icon="i-lucide-check-circle"
              title="Cuadre exacto"
              description="Los saldos materializados coinciden exactamente con la reconstrucción del libro inmutable de maquila."
            />
            <div v-else class="space-y-3">
              <UAlert
                color="error"
                variant="subtle"
                icon="i-lucide-alert-triangle"
                title="Descuadre detectado"
                description="Se encontraron diferencias entre los saldos materializados y el libro de movimientos."
              />
              <div class="overflow-x-auto">
                <table class="w-full text-xs">
                  <thead class="bg-elevated text-muted uppercase">
                    <tr>
                      <th class="px-2 py-1 text-left">Cliente</th>
                      <th class="px-2 py-1 text-left">Envase</th>
                      <th class="px-2 py-1 text-right">Vacíos Saldo / Libro</th>
                      <th class="px-2 py-1 text-right">Llenos Saldo / Libro</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-default">
                    <tr
                      v-for="d in reconciliationResult.discrepancies"
                      :key="d.customerId + d.containerTypeId"
                    >
                      <td class="px-2 py-1">{{ d.customerName }}</td>
                      <td class="px-2 py-1">{{ d.containerTypeName }}</td>
                      <td class="px-2 py-1 text-right tabular-nums">
                        {{ d.bookEmpty }} / {{ d.ledgerEmpty }}
                      </td>
                      <td class="px-2 py-1 text-right tabular-nums">
                        {{ d.bookFull }} / {{ d.ledgerFull }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div class="flex justify-end pt-2">
            <UButton
              color="neutral"
              variant="outline"
              label="Cerrar"
              @click="reconciliationModalOpen = false"
            />
          </div>
        </div>
      </template>
    </UModal>

    <!-- Modal Anular Movimiento -->
    <UModal v-model:open="voidModalOpen" title="Anular movimiento de maquila">
      <template #body>
        <form class="space-y-4" @submit.prevent="submitVoid">
          <UAlert v-if="voidError" role="alert" color="error" variant="subtle" :title="voidError" />

          <p class="text-sm text-muted">
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
  </AppPage>
</template>
