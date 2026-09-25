<script setup lang="ts">
import {
  PAYMENTS_PAGE_SIZE,
  formatInstantInLima,
  formatDebtBalance,
  formatSoles,
  limaDayEnd,
  limaDayStart,
} from "@yacco/shared";
import type {
  Customer,
  PaymentActionResult,
  PaymentMethod,
  PaymentRow,
  PaymentStatus,
  PaymentTotals,
} from "@yacco/shared";

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

const status = ref<PaymentStatus | typeof ALL>("PENDING");
const methodId = ref(ALL);
const customer = ref<Customer | null>(null);
const paidFromDay = ref("");
const paidToDay = ref("");

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
    paidTo: limaDayEnd(paidToDay.value),
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
  return `${count} ${count === 1 ? "pago" : "pagos"} con este filtro · ${formatSoles(amount)}`;
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
</script>

<template>
  <AppPage title="Pagos" :description="summary">
    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div class="flex flex-wrap items-end gap-4 border-b border-default p-4">
        <UFormField label="Estado" class="w-40">
          <USelect v-model="status" :items="statusItems" class="w-full" />
        </UFormField>
        <UFormField label="Método de pago" class="w-44">
          <USelect v-model="methodId" :items="methodItems" class="w-full" />
        </UFormField>
        <UFormField label="Cobrado desde">
          <UInput v-model="paidFromDay" type="date" />
        </UFormField>
        <UFormField label="Cobrado hasta">
          <UInput v-model="paidToDay" type="date" />
        </UFormField>
        <div class="min-w-56 flex-1">
          <CustomerPicker v-model="customer" label="Cliente" />
        </div>
        <UButton
          v-if="hasFilters"
          color="neutral"
          variant="ghost"
          icon="i-lucide-x"
          label="Limpiar filtros"
          @click="clearFilters"
        />
      </div>

      <div
        v-if="notice || actionError || (list.slow.value && list.loading.value)"
        class="space-y-2 p-4 pb-0"
      >
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
      </div>

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
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <caption class="sr-only">
              Pagos con cliente, método, monto, estado y quién los registró
            </caption>
            <thead class="bg-elevated text-left text-xs tracking-wide text-muted uppercase">
              <tr>
                <th scope="col" class="px-4 py-2 font-medium">Cliente</th>
                <th scope="col" class="px-4 py-2 font-medium">Método</th>
                <th scope="col" class="px-4 py-2 text-right font-medium">Monto</th>
                <th scope="col" class="px-4 py-2 font-medium">Estado</th>
                <th scope="col" class="px-4 py-2 font-medium">Cobrado</th>
                <th scope="col" class="px-4 py-2 font-medium">Registrado por</th>
                <th v-if="isAdmin" scope="col" class="px-4 py-2">
                  <span class="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-default">
              <template v-for="payment in list.items.value" :key="payment.id">
                <tr class="align-top">
                  <td class="px-4 py-3">
                    <p class="font-medium text-highlighted">{{ payment.customer.name }}</p>
                    <p v-if="payment.location" class="text-muted">{{ payment.location.name }}</p>
                  </td>
                  <td class="px-4 py-3">{{ payment.paymentMethod.name }}</td>
                  <!-- El tachado refuerza, nunca reemplaza: lo que dice que se anuló es el badge. -->
                  <td
                    class="px-4 py-3 text-right tabular-nums"
                    :class="
                      payment.voidedAt === null
                        ? 'font-medium text-highlighted'
                        : 'text-muted line-through'
                    "
                  >
                    {{ formatSoles(payment.amount) }}
                  </td>
                  <td class="space-y-1 px-4 py-3">
                    <div class="flex flex-wrap gap-1.5">
                      <UBadge
                        :color="PAYMENT_STATUS[payment.status].color"
                        variant="subtle"
                        :label="PAYMENT_STATUS[payment.status].label"
                      />
                      <UBadge
                        v-if="payment.voidedAt !== null"
                        color="error"
                        variant="solid"
                        label="Anulado"
                      />
                    </div>
                    <!-- Cada motivo se nombra: un cobro puede estar rechazado Y anulado. -->
                    <p
                      v-if="payment.status === 'REJECTED' && payment.rejectionReason"
                      class="text-muted"
                    >
                      Motivo del rechazo: {{ payment.rejectionReason }}
                    </p>
                    <p v-if="payment.voidedAt !== null && payment.voidReason" class="text-muted">
                      Motivo de la anulación: {{ payment.voidReason }}
                    </p>
                  </td>
                  <td class="px-4 py-3 whitespace-nowrap tabular-nums">
                    {{ formatInstantInLima(payment.paidAt) }}
                  </td>
                  <td class="px-4 py-3 text-muted">{{ payment.recordedBy.username }}</td>
                  <td v-if="isAdmin" class="px-4 py-3 text-right">
                    <div
                      v-if="canResolve(payment) && rejectingId !== payment.id"
                      class="flex justify-end gap-1"
                    >
                      <UButton
                        size="sm"
                        color="success"
                        variant="soft"
                        :disabled="actingId !== null"
                        :label="actingId === payment.id ? 'Confirmando…' : 'Confirmar'"
                        @click="confirm(payment)"
                      />
                      <UButton
                        size="sm"
                        color="error"
                        variant="ghost"
                        label="Rechazar"
                        :disabled="actingId !== null"
                        @click="startReject(payment)"
                      />
                    </div>
                  </td>
                </tr>
                <tr v-if="rejectingId === payment.id">
                  <td :colspan="isAdmin ? 7 : 6" class="px-4 pb-4">
                    <PaymentRejectForm
                      :payment="payment"
                      @cancel="rejectingId = null"
                      @rejected="(result) => rejected(payment, result)"
                      @stale="rejectStale"
                    />
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>

        <ListPagination
          :shown-page="list.shownPage.value"
          :page="list.page.value"
          :total-pages="list.totalPages.value"
          @previous="list.previous"
          @next="list.next"
        />
      </template>
    </UCard>
  </AppPage>
</template>
