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

const columns = computed<TableColumn<ReceiptSaleStatusRow>[]>(() => {
  const sale: TableColumn<ReceiptSaleStatusRow>[] = [
    { accessorKey: "soldAt", header: "Venta" },
    { accessorKey: "location", header: "Local" },
    { accessorKey: "total", header: "Total", meta: RIGHT_ALIGNED },
  ];
  if (status.value === "AVAILABLE") {
    return [
      { id: "select", header: hiddenHeader("Elegir"), meta: SHRINK_TO_CONTENT },
      ...sale,
      { id: "register", header: hiddenHeader("Acciones"), meta: RIGHT_ALIGNED },
    ];
  }
  if (status.value === "RECEIPTED") return [...sale, { id: "receipt", header: "Comprobante" }];
  return [
    ...sale,
    { id: "exemption", header: "Motivo" },
    ...(props.isAdmin
      ? [{ id: "release", header: hiddenHeader("Acciones"), meta: RIGHT_ALIGNED }]
      : []),
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

    <UPageBody>
      <SegmentedFilter v-model="status" label="Estado" :options="statusOptions" />

      <UAlert v-if="notice" role="status" color="success" variant="subtle" :title="notice" />
      <UAlert v-if="loadError" role="status" color="error" variant="subtle" :title="loadError" />
      <UAlert v-if="error" role="alert" color="error" variant="subtle" :title="error" />

      <UAlert v-if="loading" role="status" color="neutral" variant="soft" title="Cargando ventas…">
        <template #leading>
          <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin" />
        </template>
      </UAlert>
      <UAlert v-else-if="rows.length === 0" color="neutral" variant="soft" :title="emptyTitle" />

      <template v-else>
        <UTable :data="rows" :columns="columns" :caption="caption">
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
            {{ formatInstantInLima(row.original.soldAt) }}
          </template>
          <template #location-cell="{ row }">
            {{ row.original.location.name }}
          </template>
          <template #total-cell="{ row }">
            {{ formatSoles(row.original.total) }}
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
            {{ row.original.exemption?.reason }}
          </template>
          <template #receipt-cell="{ row }">
            <UButton
              v-if="row.original.receipt"
              :to="`/receipts/${row.original.receipt.id}`"
              color="primary"
              variant="link"
              :label="`${RECEIPT_TYPE[row.original.receipt.type].label} ${receiptNumber(
                row.original.receipt.series,
                row.original.receipt.number,
              )}`"
            />
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

        <UPageCard v-if="status === 'AVAILABLE'" variant="soft">
          <UPageBody v-if="marking">
            <UFormField label="Motivo para marcar las ventas" required>
              <UTextarea v-model="markReason" class="w-full" :rows="2" :disabled="saving" />
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
          </UPageBody>
          <UButton
            v-else
            color="neutral"
            variant="outline"
            label="No lleva comprobante"
            :disabled="selectedSaleIds.length === 0"
            @click="startMarking"
          />
        </UPageCard>

        <UPageCard v-if="status === 'EXEMPT' && releasingId" variant="soft">
          <UPageBody>
            <UFormField label="Motivo para liberar la marca" required>
              <UTextarea v-model="releaseReason" class="w-full" :rows="2" :disabled="saving" />
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
          </UPageBody>
        </UPageCard>
      </template>
    </UPageBody>
  </SectionCard>
</template>
