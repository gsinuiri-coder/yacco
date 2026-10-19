<script setup lang="ts">
import { formatCalendarDay, limaToday } from "@yacco/shared";
import type { ProductionReport } from "@yacco/shared";
import type { TableColumn } from "@nuxt/ui";

/**
 * HU-21: cuánto se produjo en un período, por tipo de envase y por lote. Las
 * fechas son días de Lima como texto ("AAAA-MM-DD"): nunca pasan por `Date`.
 * Arranca en el mes en curso.
 */
useHead({ title: "Producción por período · Yacco" });

const today = limaToday();
const dateFrom = ref(`${today.slice(0, 8)}01`);
const dateTo = ref(today);

const report = useReport<ProductionReport>("/reports/production", () => ({
  dateFrom: dateFrom.value,
  dateTo: dateTo.value,
}));

const batchColumns: TableColumn<ProductionReport["batches"][number]>[] = [
  { accessorKey: "code", header: "Lote" },
  { id: "date", header: "Fecha" },
  { id: "items", header: "Por tipo de envase" },
  { accessorKey: "total", header: "Total", meta: RIGHT_ALIGNED },
];
</script>

<template>
  <AppPage
    title="Producción por período"
    description="Cuánto se llenó, por tipo de envase y por lote."
  >
    <UPageBody>
      <UForm
        v-if="report.isAdmin.value"
        :state="{}"
        :validate-on="[]"
        :loading-auto="false"
        novalidate
        aria-label="Período"
        @submit="report.load"
      >
        <UPageGrid>
          <UFormField label="Desde">
            <UInput v-model="dateFrom" type="date" class="w-full" />
          </UFormField>
          <UFormField label="Hasta">
            <UInput v-model="dateTo" type="date" class="w-full" />
          </UFormField>
        </UPageGrid>
        <UButton
          type="submit"
          icon="i-lucide-search"
          label="Ver"
          :disabled="report.loading.value"
        />
      </UForm>

      <ReportState
        :is-admin="report.isAdmin.value"
        :loading="report.loading.value"
        :slow="report.slow.value"
        :error-message="report.errorMessage.value"
        :empty="report.data.value?.batches.length === 0"
        empty-title="No hubo producción en esas fechas"
        empty-description="Prueba con otro período."
        @retry="report.load"
      >
        <UPageBody v-if="report.data.value">
          <!-- UPageGrid como `dl`: StatTile pinta dt/dd, que sólo valen dentro de una. -->
          <UPageGrid as="dl">
            <StatTile label="Total producido" :value="report.data.value.total" />
            <StatTile
              v-for="line in report.data.value.byType"
              :key="line.containerType.id"
              :label="line.containerType.name"
              :value="line.producedQty"
            />
          </UPageGrid>
          <UTable
            :data="report.data.value.batches"
            :columns="batchColumns"
            caption="Lotes del período, con lo producido de cada tipo de envase"
          >
            <template #date-cell="{ row }">{{ formatCalendarDay(row.original.date) }}</template>
            <template #items-cell="{ row }">
              {{
                row.original.items
                  .map((item) => `${item.producedQty} × ${item.containerType.name}`)
                  .join(", ")
              }}
            </template>
          </UTable>
        </UPageBody>
      </ReportState>
    </UPageBody>
  </AppPage>
</template>
