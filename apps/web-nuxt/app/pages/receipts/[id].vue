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
  { accessorKey: "total", header: "Total", meta: RIGHT_ALIGNED },
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
      <UButton
        v-if="receipt?.status === 'ACTIVE' && receipt.type !== 'CREDIT_NOTE'"
        color="neutral"
        variant="outline"
        icon="i-lucide-file-minus"
        label="Registrar nota de crédito"
        aria-label="Registrar nota de crédito"
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
      />
      <UButton
        v-if="canVoid"
        color="error"
        variant="outline"
        icon="i-lucide-ban"
        label="Anular comprobante"
        aria-label="Anular comprobante"
        @click="startAction('void')"
      />
      <UButton
        to="/receipts"
        color="neutral"
        variant="ghost"
        icon="i-lucide-arrow-left"
        label="Volver a comprobantes"
        aria-label="Volver a comprobantes"
      />
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
      <UPageBody v-if="receipt">
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

        <SectionCard
          v-if="action === 'void'"
          title="Anular comprobante"
          :description="
            receipt.type === 'CREDIT_NOTE'
              ? 'La nota seguirá visible como anulada. El comprobante original sigue anulado: para restaurarlo, vuelve a registrarlo.'
              : 'El registro seguirá visible y sus ventas volverán a quedar disponibles.'
          "
        >
          <UForm :state="{}" :validate-on="[]" :loading-auto="false" @submit="voidReceipt">
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
            <UFieldGroup>
              <UButton
                type="button"
                color="neutral"
                variant="ghost"
                label="Cancelar"
                :disabled="saving"
                @click="cancelAction"
              />
              <UButton type="submit" color="error" label="Confirmar anulación" :loading="saving" />
            </UFieldGroup>
          </UForm>
        </SectionCard>

        <SectionCard
          v-if="action === 'credit-note'"
          title="Registrar nota de crédito"
          description="La nota conserva los montos del comprobante y libera sus ventas."
        >
          <UForm :state="{}" :validate-on="[]" :loading-auto="false" @submit="createCreditNote">
            <UPageGrid>
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
            </UPageGrid>
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
            <UFieldGroup>
              <UButton
                type="button"
                color="neutral"
                variant="ghost"
                label="Cancelar"
                :disabled="saving"
                @click="cancelAction"
              />
              <UButton type="submit" label="Guardar nota de crédito" :loading="saving" />
            </UFieldGroup>
          </UForm>
        </SectionCard>

        <UPageGrid>
          <UPageCard title="Tipo" :description="RECEIPT_TYPE[receipt.type].label" variant="soft" />
          <UPageCard
            title="Medio"
            :description="RECEIPT_MEDIUM[receipt.medium].label"
            variant="soft"
          />
          <UPageCard
            title="Emisión"
            :description="formatCalendarDay(receipt.issuedOn)"
            variant="soft"
          />
          <UPageCard title="Cliente" variant="soft">
            <UButton
              :to="`/customers/${receipt.customer.id}`"
              variant="link"
              :label="receipt.customer.name"
            />
          </UPageCard>
        </UPageGrid>

        <SectionCard
          title="Ventas incluidas"
          description="Ventas completas cubiertas por este comprobante."
        >
          <UTable :data="receipt.sales" :columns="saleColumns" caption="Ventas del comprobante">
            <template #soldAt-cell="{ row }">
              {{ formatInstantInLima(row.original.soldAt) }}
            </template>
            <template #location-cell="{ row }">
              {{ row.original.location.name }}
            </template>
            <template #total-cell="{ row }">
              {{ formatSoles(row.original.total) }}
            </template>
          </UTable>
        </SectionCard>

        <SectionCard title="Archivos" description="Adjuntos privados del comprobante.">
          <p v-if="receipt.files.length === 0">Este comprobante no tiene archivos adjuntos.</p>
          <UPageGrid v-else>
            <ReceiptFileButton
              v-for="file in receipt.files"
              :key="file.fileName"
              :receipt-id="receipt.id"
              :file-name="file.fileName"
            />
          </UPageGrid>
        </SectionCard>

        <!-- La región se nombra por su aria-label, no por el título: así la encuentra quien la busca. -->
        <UPageCard as="section" aria-label="Montos del comprobante">
          <template #title>
            <h2>Montos</h2>
          </template>
          <!-- UPageGrid como `dl`: StatTile pinta dt/dd, que sólo valen dentro de una. -->
          <UPageGrid as="dl">
            <StatTile label="Base imponible" :value="formatSoles(receipt.taxableAmount)" />
            <StatTile label="IGV" :value="formatSoles(receipt.taxAmount)" />
            <StatTile label="Total" :value="formatSoles(receipt.total)" />
          </UPageGrid>
        </UPageCard>

        <SectionCard title="Datos fiscales usados">
          <UPageGrid>
            <UPageCard
              title="Empresa"
              :description="receipt.issuerSettingsVersion.legalName"
              variant="soft"
            >
              RUC {{ receipt.issuerSettingsVersion.taxId }}
            </UPageCard>
            <UPageCard
              title="Dirección fiscal"
              :description="receipt.issuerSettingsVersion.fiscalAddress"
              variant="soft"
            />
            <UPageCard
              title="Tasa de IGV"
              :description="`${receipt.issuerSettingsVersion.taxRate} %`"
              variant="soft"
            />
          </UPageGrid>
        </SectionCard>

        <SectionCard title="Auditoría">
          <UPageBody>
            <p>
              Registrado por {{ receipt.createdBy.username }} el
              {{ formatInstantInLima(receipt.createdAt) }}.
            </p>
            <p v-if="receipt.voidedAt && receipt.voidedBy">
              Anulado por {{ receipt.voidedBy.username }} el
              {{ formatInstantInLima(receipt.voidedAt) }}.
            </p>
            <UButton
              v-if="receipt.type === 'CREDIT_NOTE' && receipt.affectedReceiptId"
              :to="`/receipts/${receipt.affectedReceiptId}`"
              variant="link"
              label="Ver el comprobante original"
            />
            <UButton
              v-for="note in receipt.creditNotes"
              :key="note.id"
              :to="`/receipts/${note.id}`"
              variant="link"
              :label="`Nota de crédito ${receiptNumber(note.series, note.number)} (${note.status === 'ACTIVE' ? 'vigente' : 'anulada'})`"
            />
          </UPageBody>
        </SectionCard>
      </UPageBody>
    </ResourceState>
  </AppPage>
</template>
