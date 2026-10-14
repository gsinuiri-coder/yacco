<script setup lang="ts">
import { formatCalendarDay, formatInstantInLima, formatSoles } from "@yacco/shared";
import type { ReceiptDetail } from "@yacco/shared";

const route = useRoute();
const receiptId = String(route.params.id);
const resource = useApiResource<ReceiptDetail>(`/receipts/${receiptId}`);
const receipt = resource.data;

const title = computed(() => {
  if (receipt.value === null) return "Comprobante";
  return `${RECEIPT_TYPE[receipt.value.type].label} ${receiptNumber(receipt.value.series, receipt.value.number)}`;
});

useHead(() => ({ title: `${title.value} · Yacco` }));
</script>

<template>
  <AppPage :title="title" :description="receipt ? receipt.customer.name : 'Cargando…'">
    <template #actions>
      <UButton
        to="/receipts"
        color="neutral"
        variant="ghost"
        icon="i-lucide-arrow-left"
        label="Volver a comprobantes"
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
      <div v-if="receipt" class="space-y-6">
        <UAlert
          v-if="receipt.status === 'VOIDED'"
          color="error"
          variant="subtle"
          icon="i-lucide-ban"
          title="Anulado"
          :description="receipt.voidReason ?? undefined"
        />

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
              <div class="overflow-x-auto">
                <table class="w-full text-sm">
                  <caption class="sr-only">
                    Ventas del comprobante
                  </caption>
                  <thead class="bg-elevated text-left text-xs tracking-wide text-muted uppercase">
                    <tr>
                      <th scope="col" class="px-4 py-2 font-medium">Venta</th>
                      <th scope="col" class="px-4 py-2 font-medium">Local</th>
                      <th scope="col" class="px-4 py-2 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-default">
                    <tr v-for="sale in receipt.sales" :key="sale.id">
                      <td class="px-4 py-3 tabular-nums">
                        {{ formatInstantInLima(sale.soldAt) }}
                      </td>
                      <td class="px-4 py-3 font-medium text-highlighted">
                        {{ sale.location.name }}
                      </td>
                      <td class="px-4 py-3 text-right font-medium text-highlighted tabular-nums">
                        {{ formatSoles(sale.total) }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
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
              </div>
            </UCard>
          </div>
        </div>
      </div>
    </ResourceState>
  </AppPage>
</template>
