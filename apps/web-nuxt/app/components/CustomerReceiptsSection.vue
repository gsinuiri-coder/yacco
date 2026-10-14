<script setup lang="ts">
import { formatInstantInLima, formatSoles } from "@yacco/shared";
import type { Page, ReceiptSaleStatusRow, SaleReceiptStatus } from "@yacco/shared";

const props = defineProps<{ customerId: string; isAdmin: boolean }>();
const api = useApi();

const status = ref<SaleReceiptStatus>("AVAILABLE");
const rows = ref<ReceiptSaleStatusRow[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const selectedSaleIds = ref<string[]>([]);
const marking = ref(false);
const markReason = ref("");
const saving = ref(false);
const releasingId = ref<string | null>(null);
const releaseReason = ref("");
let latest = 0;

const statusOptions = [
  { value: "AVAILABLE" as const, label: "Sin comprobante" },
  { value: "EXEMPT" as const, label: "No llevan comprobante" },
  { value: "RECEIPTED" as const, label: "Con comprobante" },
];

const caption = computed(() => {
  if (status.value === "EXEMPT") return "Ventas que no llevan comprobante";
  if (status.value === "RECEIPTED") return "Ventas con comprobante";
  return "Ventas sin comprobante";
});

const emptyTitle = computed(() => {
  if (status.value === "EXEMPT") return "No hay ventas marcadas";
  if (status.value === "RECEIPTED") return "No hay ventas con comprobante";
  return "No hay ventas sin comprobante";
});

async function load(): Promise<void> {
  const current = ++latest;
  loading.value = true;
  loadError.value = null;
  selectedSaleIds.value = [];
  marking.value = false;
  releasingId.value = null;
  try {
    const result = await api.request<Page<ReceiptSaleStatusRow>>("/receipts/sales", {
      query: {
        customerId: props.customerId,
        status: status.value,
        page: 1,
        limit: 100,
      },
    });
    if (current === latest) rows.value = result.data;
  } catch (loadFailure) {
    if (current === latest) loadError.value = describeApiFailure(loadFailure);
  } finally {
    if (current === latest) loading.value = false;
  }
}

watch(status, load, { immediate: true });

function toggleSale(saleId: string, checked: boolean): void {
  selectedSaleIds.value = checked
    ? [...selectedSaleIds.value, saleId]
    : selectedSaleIds.value.filter((id) => id !== saleId);
}

function startMarking(): void {
  error.value = null;
  notice.value = null;
  markReason.value = "";
  marking.value = true;
}

async function markExempt(): Promise<void> {
  if (saving.value) return;
  const reason = markReason.value.trim();
  if (reason === "") {
    error.value = "Escribe por qué estas ventas no llevan comprobante.";
    return;
  }
  saving.value = true;
  error.value = null;
  try {
    const result = await api.request<{ created: number }>("/receipts/exemptions", {
      method: "POST",
      body: { customerId: props.customerId, saleIds: selectedSaleIds.value, reason },
    });
    notice.value = `Se marcaron ${result.created} ${result.created === 1 ? "venta" : "ventas"} como No lleva comprobante.`;
    await load();
  } catch (saveFailure) {
    error.value = describeApiFailure(saveFailure);
  } finally {
    saving.value = false;
  }
}

function startRelease(exemptionId: string): void {
  error.value = null;
  notice.value = null;
  releaseReason.value = "";
  releasingId.value = exemptionId;
}

async function releaseExemption(exemptionId: string): Promise<void> {
  if (saving.value) return;
  const reason = releaseReason.value.trim();
  if (reason === "") {
    error.value = "Escribe por qué se libera la marca.";
    return;
  }
  saving.value = true;
  error.value = null;
  try {
    await api.request(`/receipts/exemptions/${exemptionId}/release`, {
      method: "PATCH",
      body: { reason },
    });
    notice.value = "La venta volvió a quedar disponible para un comprobante.";
    await load();
  } catch (saveFailure) {
    error.value = describeApiFailure(saveFailure);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <SectionCard
    title="Comprobantes de ventas"
    description="Ventas disponibles, comprobadas o marcadas porque no lo requieren."
  >
    <template #actions>
      <UButton
        v-if="status === 'AVAILABLE'"
        :to="`/receipts/new?customerId=${customerId}`"
        size="sm"
        icon="i-lucide-plus"
        label="Registrar comprobante"
      />
    </template>

    <div class="space-y-4">
      <SegmentedFilter v-model="status" label="Estado" :options="statusOptions" />

      <UAlert v-if="notice" role="status" color="success" variant="subtle" :title="notice" />
      <UAlert v-if="loadError" role="status" color="error" variant="subtle" :title="loadError" />
      <UAlert v-if="error" role="alert" color="error" variant="subtle" :title="error" />

      <div v-if="loading" role="status" class="flex items-center gap-2 text-muted">
        <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin" />
        Cargando ventas…
      </div>
      <UAlert v-else-if="rows.length === 0" color="neutral" variant="soft" :title="emptyTitle" />

      <template v-else>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <caption class="sr-only">
              {{
                caption
              }}
            </caption>
            <thead class="bg-elevated text-left text-xs tracking-wide text-muted uppercase">
              <tr>
                <th v-if="status === 'AVAILABLE'" scope="col" class="px-3 py-2">
                  <span class="sr-only">Elegir</span>
                </th>
                <th scope="col" class="px-3 py-2 font-medium">Venta</th>
                <th scope="col" class="px-3 py-2 font-medium">Local</th>
                <th scope="col" class="px-3 py-2 text-right font-medium">Total</th>
                <th v-if="status === 'AVAILABLE'" scope="col" class="px-3 py-2">
                  <span class="sr-only">Acciones</span>
                </th>
                <th v-if="status !== 'AVAILABLE'" scope="col" class="px-3 py-2 font-medium">
                  {{ status === "EXEMPT" ? "Motivo" : "Comprobante" }}
                </th>
                <th v-if="status === 'EXEMPT' && isAdmin" scope="col" class="px-3 py-2">
                  <span class="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-default">
              <tr v-for="row in rows" :key="row.id" class="align-top">
                <td v-if="status === 'AVAILABLE'" class="px-3 py-3">
                  <UCheckbox
                    :model-value="selectedSaleIds.includes(row.id)"
                    :aria-label="`${formatInstantInLima(row.soldAt)} · ${row.location.name} · ${formatSoles(row.total)}`"
                    :disabled="saving"
                    @update:model-value="
                      (checked: boolean | 'indeterminate') => toggleSale(row.id, checked === true)
                    "
                  />
                </td>
                <td class="px-3 py-3 tabular-nums">{{ formatInstantInLima(row.soldAt) }}</td>
                <td class="px-3 py-3 font-medium text-highlighted">{{ row.location.name }}</td>
                <td class="px-3 py-3 text-right font-medium text-highlighted tabular-nums">
                  {{ formatSoles(row.total) }}
                </td>
                <td v-if="status === 'AVAILABLE'" class="px-3 py-3 text-right">
                  <UButton
                    :to="`/receipts/new?customerId=${customerId}&saleId=${row.id}`"
                    size="sm"
                    color="neutral"
                    variant="ghost"
                    label="Registrar comprobante"
                  />
                </td>
                <td v-if="status === 'EXEMPT'" class="px-3 py-3 text-muted">
                  {{ row.exemption?.reason }}
                </td>
                <td v-else-if="status === 'RECEIPTED'" class="px-3 py-3">
                  <ULink
                    v-if="row.receipt"
                    :to="`/receipts/${row.receipt.id}`"
                    class="font-medium text-primary hover:underline"
                  >
                    {{ RECEIPT_TYPE[row.receipt.type].label }}
                    {{ receiptNumber(row.receipt.series, row.receipt.number) }}
                  </ULink>
                </td>
                <td v-if="status === 'EXEMPT' && isAdmin" class="px-3 py-3 text-right">
                  <UButton
                    v-if="row.exemption && releasingId !== row.exemption.id"
                    size="sm"
                    color="neutral"
                    variant="ghost"
                    label="Liberar marca"
                    @click="startRelease(row.exemption.id)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="status === 'AVAILABLE'" class="border-t border-default pt-4">
          <div v-if="marking" class="space-y-3">
            <UFormField label="Motivo para marcar las ventas" required>
              <UTextarea v-model="markReason" :rows="2" :disabled="saving" class="w-full" />
            </UFormField>
            <div class="flex justify-end gap-2">
              <UButton
                color="neutral"
                variant="outline"
                label="Cancelar"
                :disabled="saving"
                @click="marking = false"
              />
              <UButton
                label="Guardar marca"
                :loading="saving"
                :disabled="saving"
                @click="markExempt"
              />
            </div>
          </div>
          <UButton
            v-else
            color="neutral"
            variant="outline"
            label="No lleva comprobante"
            :disabled="selectedSaleIds.length === 0"
            @click="startMarking"
          />
        </div>

        <div v-if="status === 'EXEMPT' && releasingId" class="border-t border-default pt-4">
          <div class="space-y-3">
            <UFormField label="Motivo para liberar la marca" required>
              <UTextarea v-model="releaseReason" :rows="2" :disabled="saving" class="w-full" />
            </UFormField>
            <div class="flex justify-end gap-2">
              <UButton
                color="neutral"
                variant="outline"
                label="Cancelar"
                :disabled="saving"
                @click="releasingId = null"
              />
              <UButton
                label="Confirmar liberación"
                :loading="saving"
                :disabled="saving"
                @click="releaseExemption(releasingId)"
              />
            </div>
          </div>
        </div>
      </template>
    </div>
  </SectionCard>
</template>
