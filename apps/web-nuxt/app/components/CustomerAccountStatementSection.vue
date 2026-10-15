<script setup lang="ts">
import { formatDebtBalance, formatInstantInLima, formatSoles } from "@yacco/shared";
import type { TableColumn, TableProps } from "@nuxt/ui";
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

function isVoided(entry: AccountStatementEntry): boolean {
  return entry.voidedAt !== null;
}

// El tachado refuerza al badge «Anulado», nunca lo reemplaza.
const columns: TableColumn<AccountStatementEntry>[] = [
  { accessorKey: "date", header: "Fecha" },
  { accessorKey: "type", header: "Tipo" },
  {
    accessorKey: "amount",
    header: "Monto",
    meta: {
      class: {
        th: "text-right",
        td: (cell) =>
          isVoided(cell.row.original) ? "text-right text-muted line-through" : "text-right",
      },
    },
  },
  { accessorKey: "runningBalance", header: "Saldo", meta: RIGHT_ALIGNED },
  { id: "detail", header: "Detalle" },
];

const tableMeta: TableProps<AccountStatementEntry>["meta"] = {
  class: { tr: (row) => (isVoided(row.original) ? "bg-elevated/60" : "") },
};
</script>

<template>
  <SectionCard title="Estado de cuenta" description="Cargos y abonos, del más antiguo al último.">
    <template v-if="!loading && !loadError && statement" #actions>
      <span>Saldo</span>
      <span>{{ formatDebtBalance(statement.closingBalance) }}</span>
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

    <UTable
      v-else
      :data="entries"
      :columns="columns"
      :meta="tableMeta"
      caption="Estado de cuenta del cliente"
    >
      <template #date-cell="{ row }">
        {{ formatInstantInLima(row.original.date) }}
      </template>
      <template #type-cell="{ row }">
        <span class="flex flex-wrap items-center gap-2">
          {{ row.original.type === "CHARGE" ? "Cargo" : "Abono" }}
          <UBadge
            v-if="row.original.isOpeningBalance"
            color="neutral"
            variant="soft"
            size="sm"
            label="Saldo inicial"
          />
          <UBadge
            v-if="row.original.voidedAt !== null"
            color="error"
            variant="subtle"
            size="sm"
            label="Anulado"
          />
        </span>
      </template>
      <template #amount-cell="{ row }">
        {{ formatSoles(row.original.amount) }}
      </template>
      <template #runningBalance-cell="{ row }">
        {{ formatDebtBalance(row.original.runningBalance) }}
      </template>
      <template #detail-cell="{ row }">
        <span v-if="row.original.type === 'PAYMENT'" class="flex flex-wrap items-center gap-2">
          {{ row.original.paymentMethodName }}
          <UBadge
            v-if="row.original.status !== null"
            :color="STATUS[row.original.status].color"
            variant="subtle"
            size="sm"
            :label="STATUS[row.original.status].label"
          />
        </span>
        <span v-else-if="row.original.locationName !== null">{{ row.original.locationName }}</span>
      </template>
    </UTable>
  </SectionCard>
</template>
