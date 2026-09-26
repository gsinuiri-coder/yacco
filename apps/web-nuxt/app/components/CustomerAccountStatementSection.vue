<script setup lang="ts">
import { formatDebtBalance, formatInstantInLima, formatSoles } from "@yacco/shared";
import type { AccountStatement, AccountStatementEntry, PaymentStatus } from "@yacco/shared";

/**
 * Estado de cuenta: cargos y abonos intercalados, con el saldo corriente que
 * calcula la API (acá no se recalcula nada).
 *
 * `openingBalance` NO se muestra: sin `from`, la API lo deja fijo en "0.00", y
 * mostrarlo le diría al dueño que todo cliente del padrón arrancó en cero. El
 * arrastre real es la fila marcada «Saldo inicial».
 *
 * Una fila anulada se MUESTRA marcada, no se esconde: el cliente vio esa
 * entrega y va a preguntar. Su saldo corriente ya viene sin su efecto.
 */
const props = defineProps<{
  customerId: string;
  /** La ficha lo sube tras registrar un cobro, que agrega una fila y mueve el saldo. */
  refreshSignal: number;
}>();

const api = useApi();
const statement = ref<AccountStatement | null>(null);
const loading = ref(true);
const loadError = ref<string | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    statement.value = await api.request<AccountStatement>(
      `/customers/${props.customerId}/account-statement`,
    );
  } catch (error) {
    loadError.value = describeApiFailure(error);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
watch(() => props.refreshSignal, load);

const STATUS: Record<PaymentStatus, { label: string; color: "warning" | "success" | "error" }> = {
  PENDING: { label: "Pendiente", color: "warning" },
  CONFIRMED: { label: "Confirmado", color: "success" },
  REJECTED: { label: "Rechazado", color: "error" },
};

const entries = computed(() => statement.value?.entries ?? []);

function rowKey(entry: AccountStatementEntry): string {
  return entry.saleId ?? entry.paymentId ?? entry.date;
}
</script>

<template>
  <SectionCard title="Estado de cuenta" description="Cargos y abonos, del más antiguo al último.">
    <template v-if="!loading && !loadError && statement" #actions>
      <span class="text-sm text-muted">Saldo</span>
      <span class="text-lg font-semibold text-highlighted tabular-nums">{{
        formatDebtBalance(statement.closingBalance)
      }}</span>
    </template>

    <ListStatus
      v-if="loadError || loading || entries.length === 0"
      :error-message="loadError"
      :loading="loading"
      :empty="true"
      loading-label="Cargando estado de cuenta…"
      error-title="No se pudo cargar el estado de cuenta"
      empty-icon="i-lucide-receipt"
      empty-title="Sin movimientos todavía"
      empty-description="Las ventas y los cobros de este cliente van a aparecer acá."
      @retry="load"
    />

    <div v-else class="overflow-x-auto">
      <table class="w-full text-sm">
        <caption class="sr-only">
          Estado de cuenta del cliente
        </caption>
        <thead class="text-left text-xs tracking-wide text-muted uppercase">
          <tr>
            <th scope="col" class="py-2 font-medium">Fecha</th>
            <th scope="col" class="py-2 font-medium">Tipo</th>
            <th scope="col" class="py-2 text-right font-medium">Monto</th>
            <th scope="col" class="py-2 text-right font-medium">Saldo</th>
            <th scope="col" class="py-2 pl-4 font-medium">Detalle</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-default">
          <tr
            v-for="entry in entries"
            :key="rowKey(entry)"
            :class="entry.voidedAt === null ? undefined : 'bg-elevated/60'"
          >
            <td class="py-3 whitespace-nowrap text-muted tabular-nums">
              {{ formatInstantInLima(entry.date) }}
            </td>
            <td class="py-3">
              <span class="flex flex-wrap items-center gap-1.5">
                {{ entry.type === "CHARGE" ? "Cargo" : "Abono" }}
                <UBadge
                  v-if="entry.isOpeningBalance"
                  color="neutral"
                  variant="soft"
                  size="sm"
                  label="Saldo inicial"
                />
                <!-- "Anulado": va pegado a Cargo o Abono, los dos masculinos. -->
                <UBadge
                  v-if="entry.voidedAt !== null"
                  color="error"
                  variant="subtle"
                  size="sm"
                  label="Anulado"
                />
              </span>
            </td>
            <!-- El tachado refuerza al badge, nunca lo reemplaza. -->
            <td
              class="py-3 text-right tabular-nums"
              :class="entry.voidedAt === null ? undefined : 'text-muted line-through'"
            >
              {{ formatSoles(entry.amount) }}
            </td>
            <td class="py-3 text-right font-medium tabular-nums">
              {{ formatDebtBalance(entry.runningBalance) }}
            </td>
            <td class="py-3 pl-4">
              <span v-if="entry.type === 'PAYMENT'" class="flex flex-wrap items-center gap-1.5">
                {{ entry.paymentMethodName }}
                <UBadge
                  v-if="entry.status !== null"
                  :color="STATUS[entry.status].color"
                  variant="subtle"
                  size="sm"
                  :label="STATUS[entry.status].label"
                />
              </span>
              <span v-else-if="entry.locationName !== null" class="text-muted">{{
                entry.locationName
              }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </SectionCard>
</template>
