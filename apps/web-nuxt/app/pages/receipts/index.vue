<script setup lang="ts">
import { formatCalendarDay, formatSoles } from "@yacco/shared";
import type { TableColumn } from "@nuxt/ui";
import type { ReceiptMedium, ReceiptRow, ReceiptStatus, ReceiptType } from "@yacco/shared";

useHead({ title: "Comprobantes · Yacco" });

const ALL = "all";
const type = ref<ReceiptType | typeof ALL>(ALL);
const medium = ref<ReceiptMedium | typeof ALL>(ALL);
const status = ref<ReceiptStatus | typeof ALL>(ALL);
const issuedFrom = ref("");
const issuedTo = ref("");

const typeItems = [
  { label: "Todos", value: ALL },
  ...Object.entries(RECEIPT_TYPE).map(([value, item]) => ({ label: item.label, value })),
];
const mediumItems = [
  { label: "Todos", value: ALL },
  ...Object.entries(RECEIPT_MEDIUM).map(([value, item]) => ({ label: item.label, value })),
];
const statusItems = [
  { label: "Todos", value: ALL },
  ...Object.entries(RECEIPT_STATUS).map(([value, item]) => ({ label: item.label, value })),
];

const list = usePagedList<ReceiptRow>(
  "/receipts",
  20,
  computed(() => ({
    type: type.value === ALL ? undefined : type.value,
    medium: medium.value === ALL ? undefined : medium.value,
    status: status.value === ALL ? undefined : status.value,
    issuedFrom: issuedFrom.value,
    issuedTo: issuedTo.value,
  })),
);

const hasFilters = computed(
  () =>
    type.value !== ALL ||
    medium.value !== ALL ||
    status.value !== ALL ||
    issuedFrom.value !== "" ||
    issuedTo.value !== "",
);

function clearFilters(): void {
  type.value = ALL;
  medium.value = ALL;
  status.value = ALL;
  issuedFrom.value = "";
  issuedTo.value = "";
}

const columns: TableColumn<ReceiptRow>[] = [
  { accessorKey: "number", header: "Comprobante" },
  { accessorKey: "customer", header: "Cliente" },
  { accessorKey: "medium", header: "Medio" },
  { accessorKey: "issuedOn", header: "Emisión" },
  { accessorKey: "total", header: "Total", meta: RIGHT_ALIGNED },
  { accessorKey: "status", header: "Estado" },
];

const summary = computed(() => {
  if (list.firstLoad.value) return "Cargando…";
  const count = list.total.value;
  return `${count} ${count === 1 ? "comprobante" : "comprobantes"}`;
});
</script>

<template>
  <AppPage title="Comprobantes" :description="summary">
    <template #actions>
      <UButton to="/receipts/new" icon="i-lucide-plus" label="Registrar comprobante" />
    </template>

    <UCard>
      <template #header>
        <UPageGrid>
          <UFormField label="Tipo">
            <USelect v-model="type" :items="typeItems" />
          </UFormField>
          <UFormField label="Medio">
            <USelect v-model="medium" :items="mediumItems" />
          </UFormField>
          <UFormField label="Estado">
            <USelect v-model="status" :items="statusItems" />
          </UFormField>
          <UFormField label="Emitido desde">
            <UInput v-model="issuedFrom" type="date" />
          </UFormField>
          <UFormField label="Emitido hasta">
            <UInput v-model="issuedTo" type="date" />
          </UFormField>
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

      <ListStatus
        v-if="list.errorMessage.value || list.firstLoad.value || list.items.value.length === 0"
        :error-message="list.errorMessage.value"
        :loading="list.firstLoad.value"
        :empty="list.items.value.length === 0"
        loading-label="Cargando comprobantes…"
        empty-icon="i-lucide-receipt-text"
        :empty-title="
          hasFilters
            ? 'Ningún comprobante coincide con el filtro'
            : 'Todavía no hay comprobantes registrados'
        "
        :empty-description="
          hasFilters
            ? 'Prueba con otro tipo, medio, estado o rango de fechas.'
            : 'Registra una boleta o factura emitida fuera de Yacco.'
        "
        @retry="list.retry"
      >
        <template #empty-actions>
          <UButton
            v-if="!hasFilters"
            to="/receipts/new"
            icon="i-lucide-plus"
            label="Registrar comprobante"
          />
          <UButton
            v-else
            color="neutral"
            variant="outline"
            label="Limpiar filtros"
            @click="clearFilters"
          />
        </template>
      </ListStatus>

      <template v-else>
        <UTable :data="list.items.value" :columns="columns" caption="Comprobantes registrados">
          <template #number-cell="{ row }">
            <p>
              <UButton
                :to="`/receipts/${row.original.id}`"
                variant="link"
                :label="receiptNumber(row.original.series, row.original.number)"
              />
            </p>
            <p>
              <UBadge
                :color="RECEIPT_TYPE[row.original.type].color"
                variant="subtle"
                :label="RECEIPT_TYPE[row.original.type].label"
              />
            </p>
          </template>
          <template #customer-cell="{ row }">
            {{ row.original.customer.name }}
          </template>
          <template #medium-cell="{ row }">
            {{ RECEIPT_MEDIUM[row.original.medium].label }}
          </template>
          <template #issuedOn-cell="{ row }">
            {{ formatCalendarDay(row.original.issuedOn) }}
          </template>
          <template #total-cell="{ row }">
            {{ formatSoles(row.original.total) }}
          </template>
          <template #status-cell="{ row }">
            <UBadge
              :color="RECEIPT_STATUS[row.original.status].color"
              variant="subtle"
              :label="RECEIPT_STATUS[row.original.status].label"
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
    </UCard>
  </AppPage>
</template>
