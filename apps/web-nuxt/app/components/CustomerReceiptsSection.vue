<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
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

const RIGHT = { class: { th: "text-right", td: "text-right" } };

const columns = computed<TableColumn<ReceiptSaleStatusRow>[]>(() => {
  const sale: TableColumn<ReceiptSaleStatusRow>[] = [
    { accessorKey: "soldAt", header: "Venta" },
    { accessorKey: "location", header: "Local" },
    { accessorKey: "total", header: "Total", meta: RIGHT },
  ];
  if (status.value === "AVAILABLE") {
    return [
      { id: "select", meta: { class: { td: "w-0" } } },
      ...sale,
      { id: "register", meta: RIGHT },
    ];
  }
  if (status.value === "RECEIPTED") return [...sale, { id: "receipt", header: "Comprobante" }];
  return [
    ...sale,
    { id: "exemption", header: "Motivo" },
    ...(props.isAdmin ? [{ id: "release", meta: RIGHT }] : []),
  ];
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
        <UTable :data="rows" :columns="columns" :caption="caption" :ui="{ caption: 'sr-only' }">
          <template #select-header>
            <span class="sr-only">Elegir</span>
          </template>
          <template #select-cell="{ row }">
            <UCheckbox
              :model-value="selectedSaleIds.includes(row.original.id)"
              :aria-label="`${formatInstantInLima(row.original.soldAt)} · ${row.original.location.name} · ${formatSoles(row.original.total)}`"
              :disabled="saving"
              @update:model-value="
                (checked: boolean | 'indeterminate') =>
                  toggleSale(row.original.id, checked === true)
              "
            />
          </template>
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
          <template #register-header>
            <span class="sr-only">Acciones</span>
          </template>
          <template #register-cell="{ row }">
            <UButton
              :to="`/receipts/new?customerId=${customerId}&saleId=${row.original.id}`"
              size="sm"
              color="neutral"
              variant="ghost"
              label="Registrar comprobante"
            />
          </template>
          <template #exemption-cell="{ row }">
            <span class="text-muted">{{ row.original.exemption?.reason }}</span>
          </template>
          <template #receipt-cell="{ row }">
            <ULink
              v-if="row.original.receipt"
              :to="`/receipts/${row.original.receipt.id}`"
              class="font-medium text-primary hover:underline"
            >
              {{ RECEIPT_TYPE[row.original.receipt.type].label }}
              {{ receiptNumber(row.original.receipt.series, row.original.receipt.number) }}
            </ULink>
          </template>
          <template #release-header>
            <span class="sr-only">Acciones</span>
          </template>
          <template #release-cell="{ row }">
            <UButton
              v-if="row.original.exemption && releasingId !== row.original.exemption.id"
              size="sm"
              color="neutral"
              variant="ghost"
              label="Liberar marca"
              @click="startRelease(row.original.exemption.id)"
            />
          </template>
        </UTable>

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
