<script setup lang="ts">
import {
  PAYMENTS_PAGE_SIZE,
  formatInstantInLima,
  formatDebtBalance,
  formatSoles,
  limaDayStart,
  nextCalendarDay,
} from "@yacco/shared";
import type {
  Customer,
  PaymentActionResult,
  PaymentMethod,
  PaymentRow,
  PaymentStatus,
  PaymentTotals,
} from "@yacco/shared";
import type { TableColumn } from "@nuxt/ui";

/**
 * Bandeja de confirmación de pagos (HU-19). Lo que el dueño viene a hacer es
 * confirmar los Yape, Plin y transferencias que llegaron, así que ARRANCA en
 * Pendiente: ese es el trabajo, no un filtro más. Confirmar y rechazar son
 * de ADMIN; el rechazo pide motivo.
 */
useHead({ title: "Pagos · Yacco" });

const session = useSession();
const api = useApi();
const isAdmin = computed(() => session.hasRole("ADMIN"));
const ALL = "all";

// El estado y los días pueden llegar en la URL (los enlaces del Panel).
const query = useRoute().query;
const status = ref<PaymentStatus | typeof ALL>(
  queryChoice<PaymentStatus | typeof ALL>(
    query.status,
    [ALL, ...(Object.keys(PAYMENT_STATUS) as PaymentStatus[])],
    "PENDING",
  ),
);
const methodId = ref(ALL);
const customer = ref<Customer | null>(null);
const paidFromDay = ref(queryText(query.paidFrom));
const paidToDay = ref(queryText(query.paidTo));

// Catálogo de su endpoint; si falla, el filtro queda en «Todos» y la bandeja sigue.
const methods = useCatalog<PaymentMethod>("/payment-methods");

const statusItems = [
  { label: "Todos", value: ALL },
  ...(Object.entries(PAYMENT_STATUS) as Array<[PaymentStatus, { label: string }]>).map(
    ([value, { label }]) => ({ label, value }),
  ),
];
const methodItems = computed(() => [
  { label: "Todos", value: ALL },
  ...methods.items.value.map((method) => ({ label: method.name, value: method.id })),
]);

const list = usePagedList<PaymentRow>(
  "/payments",
  PAYMENTS_PAGE_SIZE,
  computed(() => ({
    status: status.value === ALL ? undefined : status.value,
    paymentMethodId: methodId.value === ALL ? undefined : methodId.value,
    customerId: customer.value?.id,
    // Filtran por INSTANTE: el día elegido se vuelve límite en Lima como texto.
    paidFrom: limaDayStart(paidFromDay.value),
    paidBefore: limaDayStart(nextCalendarDay(paidToDay.value)),
  })),
);

// El punto de partida es Pendiente: «Limpiar» vuelve ahí, no a «Todos».
const hasFilters = computed(
  () =>
    status.value !== "PENDING" ||
    methodId.value !== ALL ||
    customer.value !== null ||
    paidFromDay.value !== "" ||
    paidToDay.value !== "",
);
function clearFilters(): void {
  status.value = "PENDING";
  methodId.value = ALL;
  customer.value = null;
  paidFromDay.value = "";
  paidToDay.value = "";
}

/** El total de TODO el filtro, no de la página a la vista. */
const totals = computed(
  () => (list.result.value as { totals?: PaymentTotals } | null)?.totals ?? null,
);
const summary = computed(() => {
  if (totals.value === null) return list.firstLoad.value ? "Cargando…" : "";
  const { count, amount } = totals.value;
  return `${count} ${count === 1 ? "pago vigente" : "pagos vigentes"} con este filtro · ${formatSoles(amount)}`;
});

const actingId = ref<string | null>(null);
const rejectingId = ref<string | null>(null);
const notice = ref<string | null>(null);
const actionError = ref<string | null>(null);

/**
 * El estado solo no alcanza: anular NO cambia el estado, así que un cobro
 * anulado puede seguir en Pendiente. Ofrecerle Confirmar o Rechazar le haría
 * comer a la oficina el 409 que la API devuelve para un cobro anulado.
 */
function canResolve(payment: PaymentRow): boolean {
  return payment.status === "PENDING" && payment.voidedAt === null;
}

async function confirm(payment: PaymentRow): Promise<void> {
  if (actingId.value !== null) return;
  actingId.value = payment.id;
  notice.value = null;
  actionError.value = null;
  try {
    const result = await api.request<PaymentActionResult>(`/payments/${payment.id}/confirm`, {
      method: "POST",
    });
    notice.value = `Pago de ${payment.customer.name} confirmado. Deuda actual: ${formatDebtBalance(result.debtBalance)}.`;
    list.retry();
  } catch (error) {
    const stale = paymentStaleMessage(error);
    actionError.value = stale ?? paymentActionFailure(error, "confirmar");
    if (stale !== null) list.retry();
  } finally {
    actingId.value = null;
  }
}

function startReject(payment: PaymentRow): void {
  rejectingId.value = payment.id;
  notice.value = null;
  actionError.value = null;
}

function rejected(payment: PaymentRow, result: PaymentActionResult): void {
  rejectingId.value = null;
  notice.value = `Pago de ${payment.customer.name} rechazado. Deuda actual: ${formatDebtBalance(result.debtBalance)}.`;
  list.retry();
}

function rejectStale(message: string): void {
  rejectingId.value = null;
  actionError.value = message;
  list.retry();
}

// El tachado refuerza, nunca reemplaza: lo que dice que se anuló es el badge.
const columns = computed<TableColumn<PaymentRow>[]>(() => [
  { accessorKey: "customer", header: "Cliente" },
  { accessorKey: "paymentMethod", header: "Método" },
  {
    accessorKey: "amount",
    header: "Monto",
    meta: {
      class: {
        th: "text-right",
        td: (cell) =>
          cell.row.original.voidedAt === null
            ? "text-right font-medium text-highlighted"
            : "text-right text-muted line-through",
      },
    },
  },
  { accessorKey: "status", header: "Estado", meta: WRAPPING_TEXT },
  { accessorKey: "paidAt", header: "Cobrado" },
  { accessorKey: "recordedBy", header: "Registrado por" },
  ...(isAdmin.value
    ? [{ id: "actions", header: hiddenHeader("Acciones"), meta: RIGHT_ALIGNED }]
    : []),
]);
// El rechazo pide motivo en un formulario debajo de la fila del pago.
const expandedPaymentIds = computed<Record<string, boolean>>(() =>
  rejectingId.value === null ? {} : { [rejectingId.value]: true },
);
</script>

<template>
  <AppPage title="Pagos" :description="summary">
    <UCard>
      <template #header>
        <UPageGrid>
          <UFormField label="Estado">
            <USelect v-model="status" :items="statusItems" />
          </UFormField>
          <UFormField label="Método de pago">
            <USelect v-model="methodId" :items="methodItems" />
          </UFormField>
          <UFormField label="Cobrado desde">
            <UInput v-model="paidFromDay" type="date" />
          </UFormField>
          <UFormField label="Cobrado hasta">
            <UInput v-model="paidToDay" type="date" />
          </UFormField>
          <CustomerPicker v-model="customer" label="Cliente" />
          <UButton
            v-if="hasFilters"
            color="neutral"
            variant="ghost"
            icon="i-lucide-x"
            label="Limpiar filtros"
            @click="clearFilters"
          />
        </UPageGrid>
      </template>

      <UPageBody>
        <UAlert v-if="notice" role="status" color="success" variant="subtle" :title="notice" />
        <UAlert
          v-if="actionError"
          role="alert"
          color="error"
          variant="subtle"
          :title="actionError"
        />
        <UAlert
          v-if="list.slow.value && list.loading.value"
          role="status"
          color="neutral"
          variant="subtle"
          :title="SLOW_REQUEST_MESSAGE"
        />

        <ListStatus
          v-if="list.errorMessage.value || list.firstLoad.value || list.items.value.length === 0"
          :error-message="list.errorMessage.value"
          :loading="list.firstLoad.value"
          :empty="list.items.value.length === 0"
          loading-label="Cargando pagos…"
          empty-icon="i-lucide-wallet"
          :empty-title="
            hasFilters ? 'Ningún pago coincide con el filtro' : 'No hay pagos por confirmar'
          "
          :empty-description="
            hasFilters
              ? 'Prueba con otro estado, método de pago, cliente o rango de fechas.'
              : 'Los cobros de oficina y de ruta que queden por confirmar aparecerán aquí.'
          "
          @retry="list.retry"
        />

        <template v-else>
          <UTable
            :data="list.items.value"
            :columns="columns"
            :get-row-id="(payment: PaymentRow) => payment.id"
            :expanded="expandedPaymentIds"
            caption="Pagos con cliente, método, monto, estado y quién los registró"
          >
            <template #customer-cell="{ row }">
              <UUser
                :name="row.original.customer.name"
                :description="row.original.location?.name"
              />
            </template>
            <template #paymentMethod-cell="{ row }">
              {{ row.original.paymentMethod.name }}
            </template>
            <template #amount-cell="{ row }">
              {{ formatSoles(row.original.amount) }}
            </template>
            <template #status-cell="{ row }">
              <UFieldGroup>
                <UBadge
                  :color="PAYMENT_STATUS[row.original.status].color"
                  variant="subtle"
                  :label="PAYMENT_STATUS[row.original.status].label"
                />
                <UBadge
                  v-if="row.original.voidedAt !== null"
                  color="error"
                  variant="solid"
                  label="Anulado"
                />
              </UFieldGroup>
              <!-- Cada motivo se nombra: un cobro puede estar rechazado Y anulado. -->
              <p v-if="row.original.status === 'REJECTED' && row.original.rejectionReason">
                Motivo del rechazo: {{ row.original.rejectionReason }}
              </p>
              <p v-if="row.original.voidedAt !== null && row.original.voidReason">
                Motivo de la anulación: {{ row.original.voidReason }}
              </p>
            </template>
            <template #paidAt-cell="{ row }">
              {{ formatInstantInLima(row.original.paidAt) }}
            </template>
            <template #recordedBy-cell="{ row }">
              {{ row.original.recordedBy.username }}
            </template>
            <template #actions-cell="{ row }">
              <UFieldGroup v-if="canResolve(row.original) && rejectingId !== row.original.id">
                <UButton
                  size="sm"
                  color="success"
                  variant="soft"
                  :disabled="actingId !== null"
                  :label="actingId === row.original.id ? 'Confirmando…' : 'Confirmar'"
                  @click="confirm(row.original)"
                />
                <UButton
                  size="sm"
                  color="error"
                  variant="ghost"
                  label="Rechazar"
                  :disabled="actingId !== null"
                  @click="startReject(row.original)"
                />
              </UFieldGroup>
            </template>
            <template #expanded="{ row }">
              <PaymentRejectForm
                :payment="row.original"
                @cancel="rejectingId = null"
                @rejected="(result) => rejected(row.original, result)"
                @stale="rejectStale"
              />
            </template>
          </UTable>

          <ListPagination
            :shown-page="list.shownPage.value"
            :page="list.page.value"
            :total-pages="list.totalPages.value"
            @previous="list.previous"
            @next="list.next"
          />
        </template>
      </UPageBody>
    </UCard>
  </AppPage>
</template>
