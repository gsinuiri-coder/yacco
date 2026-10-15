<script setup lang="ts">
import { formatCalendarDay, formatInstantInLima, formatSoles } from "@yacco/shared";
import type { TableColumn } from "@nuxt/ui";
import type { ReceiptDetail, ReceiptMedium, ReceiptRow, ReceiptSaleDetail } from "@yacco/shared";

const route = useRoute();
const receiptId = String(route.params.id);
const api = useApi();
const session = useSession();
const resource = useApiResource<ReceiptDetail>(`/receipts/${receiptId}`);
const receipt = resource.data;
const action = ref<"void" | "credit-note" | null>(null);
const actionError = ref<string | null>(null);
const saving = ref(false);
const voidReason = ref("");
const creditNoteMedium = ref<ReceiptMedium>("MANUAL");
const creditNoteSeries = ref("");
const creditNoteNumber = ref("");
const creditNoteIssuedOn = ref("");
const creditNoteReason = ref("");

const mediumOptions = [
  { label: "Manual", value: "MANUAL" },
  { label: "Electrónico", value: "EXTERNAL_ELECTRONIC" },
];

const saleColumns: TableColumn<ReceiptSaleDetail>[] = [
  { accessorKey: "soldAt", header: "Venta" },
  { accessorKey: "location", header: "Local" },
  {
    accessorKey: "total",
    header: "Total",
    meta: { class: { th: "text-right", td: "text-right" } },
  },
];

const title = computed(() => {
  if (receipt.value === null) return "Comprobante";
  return `${RECEIPT_TYPE[receipt.value.type].label} ${receiptNumber(receipt.value.series, receipt.value.number)}`;
});

useHead(() => ({ title: `${title.value} · Yacco` }));

// An electronic credit note is never voided; a manual one only gets marked.
const canVoid = computed(
  () =>
    receipt.value?.status === "ACTIVE" &&
    session.hasRole("ADMIN") &&
    (receipt.value.type !== "CREDIT_NOTE" || receipt.value.medium === "MANUAL"),
);

// Nothing comes back to life: the original is restored by registering it
// again, and the API says when that is still possible.
const restoreSourceId = computed(() => {
  const current = receipt.value;
  if (current === null || !current.canRegisterAgain) return null;
  return current.type === "CREDIT_NOTE" ? current.affectedReceiptId : current.id;
});

function startAction(nextAction: "void" | "credit-note"): void {
  actionError.value = null;
  action.value = nextAction;
}

function cancelAction(): void {
  action.value = null;
  actionError.value = null;
}

async function voidReceipt(): Promise<void> {
  if (saving.value) return;
  const reason = voidReason.value.trim();
  if (reason === "") {
    actionError.value = "Escribe el motivo de la anulación.";
    return;
  }
  saving.value = true;
  actionError.value = null;
  try {
    await api.request(`/receipts/${receiptId}/void`, {
      method: "PATCH",
      body: { reason },
    });
    action.value = null;
    await resource.reload();
  } catch (error) {
    actionError.value = describeApiFailure(error);
  } finally {
    saving.value = false;
  }
}

async function createCreditNote(): Promise<void> {
  if (saving.value) return;
  const series = creditNoteSeries.value.trim();
  const number = creditNoteNumber.value.trim();
  const reason = creditNoteReason.value.trim();
  if (series === "" || number === "" || creditNoteIssuedOn.value === "" || reason === "") {
    actionError.value = "Completa los datos de la nota de crédito.";
    return;
  }
  saving.value = true;
  actionError.value = null;
  try {
    const created = await api.request<ReceiptRow>(`/receipts/${receiptId}/credit-notes`, {
      method: "POST",
      body: {
        medium: creditNoteMedium.value,
        series,
        number,
        issuedOn: creditNoteIssuedOn.value,
        reason,
      },
    });
    await navigateTo(`/receipts/${created.id}`);
  } catch (error) {
    actionError.value = describeApiFailure(error);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppPage :title="title" :description="receipt ? receipt.customer.name : 'Cargando…'">
    <template #actions>
      <div class="flex flex-wrap items-center justify-end gap-2">
        <UButton
          v-if="receipt?.status === 'ACTIVE' && receipt.type !== 'CREDIT_NOTE'"
          color="neutral"
          variant="outline"
          icon="i-lucide-file-minus"
          label="Registrar nota de crédito"
          aria-label="Registrar nota de crédito"
          :ui="{ label: 'hidden sm:inline' }"
          @click="startAction('credit-note')"
        />
        <UButton
          v-if="restoreSourceId"
          :to="`/receipts/new?from=${restoreSourceId}`"
          color="neutral"
          variant="outline"
          icon="i-lucide-rotate-ccw"
          label="Volver a registrar el original"
          aria-label="Volver a registrar el original"
          :ui="{ label: 'hidden sm:inline' }"
        />
        <UButton
          v-if="canVoid"
          color="error"
          variant="outline"
          icon="i-lucide-ban"
          label="Anular comprobante"
          aria-label="Anular comprobante"
          :ui="{ label: 'hidden sm:inline' }"
          @click="startAction('void')"
        />
        <UButton
          to="/receipts"
          color="neutral"
          variant="ghost"
          icon="i-lucide-arrow-left"
          label="Volver a comprobantes"
          aria-label="Volver a comprobantes"
          :ui="{ label: 'hidden sm:inline' }"
        />
      </div>
    </template>

    <ResourceState
      :loading="resource.loading.value"
      :slow="resource.slow.value"
      :not-found="resource.notFound.value"
      :error-message="resource.errorMessage.value"
      noun="comprobante"
      article="el"
      back-to="/receipts"
      back-label="Volver a comprobantes"
      @retry="resource.reload"
    >
      <div v-if="receipt" class="space-y-6">
        <UAlert
          v-if="receipt.status === 'VOIDED'"
          color="error"
          variant="subtle"
          icon="i-lucide-ban"
          title="Anulado"
          :description="receipt.voidReason ?? undefined"
        />
        <UAlert
          v-if="receipt.registeredAgainId"
          color="info"
          variant="subtle"
          icon="i-lucide-rotate-ccw"
          title="El original ya se volvió a registrar"
          :actions="[
            {
              label: 'Ver el comprobante vigente',
              to: `/receipts/${receipt.registeredAgainId}`,
              color: 'neutral',
              variant: 'outline',
            },
          ]"
        />

        <UCard v-if="action === 'void'" class="max-w-2xl">
          <template #header>
            <div>
              <h2 class="text-lg font-semibold text-highlighted">Anular comprobante</h2>
              <p class="text-sm text-muted">
                {{
                  receipt.type === "CREDIT_NOTE"
                    ? "La nota seguirá visible como anulada. El comprobante original sigue anulado: para restaurarlo, vuelve a registrarlo."
                    : "El registro seguirá visible y sus ventas volverán a quedar disponibles."
                }}
              </p>
            </div>
          </template>
          <form class="space-y-4" @submit.prevent="voidReceipt">
            <UFormField label="Motivo de anulación" required>
              <UTextarea v-model="voidReason" :disabled="saving" class="w-full" />
            </UFormField>
            <UAlert
              v-if="actionError"
              role="alert"
              color="error"
              variant="subtle"
              :title="actionError"
            />
            <div class="flex flex-wrap justify-end gap-2">
              <UButton
                type="button"
                color="neutral"
                variant="ghost"
                label="Cancelar"
                :disabled="saving"
                @click="cancelAction"
              />
              <UButton type="submit" color="error" label="Confirmar anulación" :loading="saving" />
            </div>
          </form>
        </UCard>

        <UCard v-if="action === 'credit-note'" class="max-w-3xl">
          <template #header>
            <div>
              <h2 class="text-lg font-semibold text-highlighted">Registrar nota de crédito</h2>
              <p class="text-sm text-muted">
                La nota conserva los montos del comprobante y libera sus ventas.
              </p>
            </div>
          </template>
          <form class="space-y-4" @submit.prevent="createCreditNote">
            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField label="Medio de la nota" required>
                <USelect
                  v-model="creditNoteMedium"
                  :items="mediumOptions"
                  :disabled="saving"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="Fecha de emisión" required>
                <UInput
                  v-model="creditNoteIssuedOn"
                  type="date"
                  :disabled="saving"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="Serie de la nota" required>
                <UInput v-model="creditNoteSeries" :disabled="saving" class="w-full" />
              </UFormField>
              <UFormField label="Número de la nota" required>
                <UInput v-model="creditNoteNumber" :disabled="saving" class="w-full" />
              </UFormField>
            </div>
            <UFormField label="Motivo de la nota" required>
              <UTextarea v-model="creditNoteReason" :disabled="saving" class="w-full" />
            </UFormField>
            <UAlert
              v-if="actionError"
              role="alert"
              color="error"
              variant="subtle"
              :title="actionError"
            />
            <div class="flex flex-wrap justify-end gap-2">
              <UButton
                type="button"
                color="neutral"
                variant="ghost"
                label="Cancelar"
                :disabled="saving"
                @click="cancelAction"
              />
              <UButton type="submit" label="Guardar nota de crédito" :loading="saving" />
            </div>
          </form>
        </UCard>

        <div class="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
          <div class="space-y-6">
            <UCard>
              <dl class="grid gap-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt class="text-muted">Tipo</dt>
                  <dd class="font-medium text-highlighted">
                    {{ RECEIPT_TYPE[receipt.type].label }}
                  </dd>
                </div>
                <div>
                  <dt class="text-muted">Medio</dt>
                  <dd class="font-medium text-highlighted">
                    {{ RECEIPT_MEDIUM[receipt.medium].label }}
                  </dd>
                </div>
                <div>
                  <dt class="text-muted">Emisión</dt>
                  <dd class="font-medium text-highlighted tabular-nums">
                    {{ formatCalendarDay(receipt.issuedOn) }}
                  </dd>
                </div>
                <div>
                  <dt class="text-muted">Cliente</dt>
                  <dd>
                    <ULink
                      :to="`/customers/${receipt.customer.id}`"
                      class="font-medium text-primary hover:underline"
                    >
                      {{ receipt.customer.name }}
                    </ULink>
                  </dd>
                </div>
              </dl>
            </UCard>

            <UCard :ui="{ body: 'p-0 sm:p-0' }">
              <template #header>
                <div>
                  <h2 class="text-lg font-semibold text-highlighted">Ventas incluidas</h2>
                  <p class="text-sm text-muted">Ventas completas cubiertas por este comprobante.</p>
                </div>
              </template>
              <UTable
                :data="receipt.sales"
                :columns="saleColumns"
                caption="Ventas del comprobante"
                :ui="{ caption: 'sr-only' }"
              >
                <template #soldAt-cell="{ row }">
                  <span class="tabular-nums">{{ formatInstantInLima(row.original.soldAt) }}</span>
                </template>
                <template #location-cell="{ row }">
                  <span class="font-medium text-highlighted">{{ row.original.location.name }}</span>
                </template>
                <template #total-cell="{ row }">
                  <span class="font-medium text-highlighted tabular-nums">
                    {{ formatSoles(row.original.total) }}
                  </span>
                </template>
              </UTable>
            </UCard>

            <UCard>
              <template #header>
                <div>
                  <h2 class="text-lg font-semibold text-highlighted">Archivos</h2>
                  <p class="text-sm text-muted">Adjuntos privados del comprobante.</p>
                </div>
              </template>
              <p v-if="receipt.files.length === 0" class="text-sm text-muted">
                Este comprobante no tiene archivos adjuntos.
              </p>
              <div v-else class="flex flex-wrap gap-3">
                <ReceiptFileButton
                  v-for="file in receipt.files"
                  :key="file.fileName"
                  :receipt-id="receipt.id"
                  :file-name="file.fileName"
                />
              </div>
            </UCard>
          </div>

          <div class="space-y-6">
            <UCard role="region" aria-label="Montos del comprobante">
              <template #header>
                <h2 class="text-lg font-semibold text-highlighted">Montos</h2>
              </template>
              <dl class="space-y-3 text-sm">
                <div class="flex items-center justify-between gap-4">
                  <dt class="text-muted">Base imponible</dt>
                  <dd class="font-medium text-highlighted tabular-nums">
                    {{ formatSoles(receipt.taxableAmount) }}
                  </dd>
                </div>
                <div class="flex items-center justify-between gap-4">
                  <dt class="text-muted">IGV</dt>
                  <dd class="font-medium text-highlighted tabular-nums">
                    {{ formatSoles(receipt.taxAmount) }}
                  </dd>
                </div>
                <div class="flex items-center justify-between gap-4 border-t border-default pt-3">
                  <dt class="font-medium text-highlighted">Total</dt>
                  <dd class="font-display text-xl font-semibold text-highlighted tabular-nums">
                    {{ formatSoles(receipt.total) }}
                  </dd>
                </div>
              </dl>
            </UCard>

            <UCard>
              <template #header>
                <h2 class="text-lg font-semibold text-highlighted">Datos fiscales usados</h2>
              </template>
              <dl class="space-y-3 text-sm">
                <div>
                  <dt class="text-muted">Empresa</dt>
                  <dd class="font-medium text-highlighted">
                    {{ receipt.issuerSettingsVersion.legalName }}
                  </dd>
                  <dd class="text-muted tabular-nums">
                    RUC {{ receipt.issuerSettingsVersion.taxId }}
                  </dd>
                </div>
                <div>
                  <dt class="text-muted">Dirección fiscal</dt>
                  <dd class="font-medium text-highlighted">
                    {{ receipt.issuerSettingsVersion.fiscalAddress }}
                  </dd>
                </div>
                <div>
                  <dt class="text-muted">Tasa de IGV</dt>
                  <dd class="font-medium text-highlighted tabular-nums">
                    {{ receipt.issuerSettingsVersion.taxRate }} %
                  </dd>
                </div>
              </dl>
            </UCard>

            <UCard>
              <template #header>
                <h2 class="text-lg font-semibold text-highlighted">Auditoría</h2>
              </template>
              <div class="space-y-2 text-sm text-muted">
                <p>
                  Registrado por {{ receipt.createdBy.username }} el
                  {{ formatInstantInLima(receipt.createdAt) }}.
                </p>
                <p v-if="receipt.voidedAt && receipt.voidedBy">
                  Anulado por {{ receipt.voidedBy.username }} el
                  {{ formatInstantInLima(receipt.voidedAt) }}.
                </p>
                <p v-if="receipt.type === 'CREDIT_NOTE' && receipt.affectedReceiptId">
                  <ULink
                    :to="`/receipts/${receipt.affectedReceiptId}`"
                    class="font-medium text-primary hover:underline"
                  >
                    Ver el comprobante original
                  </ULink>
                </p>
                <p v-for="note in receipt.creditNotes" :key="note.id">
                  <ULink
                    :to="`/receipts/${note.id}`"
                    class="font-medium text-primary hover:underline"
                  >
                    Nota de crédito {{ receiptNumber(note.series, note.number) }} ({{
                      note.status === "ACTIVE" ? "vigente" : "anulada"
                    }})
                  </ULink>
                </p>
              </div>
            </UCard>
          </div>
        </div>
      </div>
    </ResourceState>
  </AppPage>
</template>
