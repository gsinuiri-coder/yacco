<script setup lang="ts">
import { formatCalendarDay, limaToday } from "@yacco/shared";
import type { ProductionReport } from "@yacco/shared";

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
</script>

<template>
  <AppPage
    title="Producción por período"
    description="Cuánto se llenó, por tipo de envase y por lote."
  >
    <form
      v-if="report.isAdmin.value"
      class="mb-4 flex flex-wrap items-end gap-3"
      novalidate
      aria-label="Período"
      @submit.prevent="report.load"
    >
      <UFormField label="Desde">
        <UInput v-model="dateFrom" type="date" />
      </UFormField>
      <UFormField label="Hasta">
        <UInput v-model="dateTo" type="date" />
      </UFormField>
      <UButton type="submit" icon="i-lucide-search" label="Ver" :disabled="report.loading.value" />
    </form>

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
      <div v-if="report.data.value" class="space-y-6">
        <dl class="grid gap-3 p-4 sm:grid-cols-3">
          <StatTile label="Total producido" :value="report.data.value.total" />
          <StatTile
            v-for="line in report.data.value.byType"
            :key="line.containerType.id"
            :label="line.containerType.name"
            :value="line.producedQty"
          />
        </dl>
        <table class="w-full text-sm">
          <caption class="sr-only">
            Lotes del período, con lo producido de cada tipo de envase
          </caption>
          <thead class="text-left text-xs tracking-wide text-muted uppercase">
            <tr>
              <th scope="col" class="px-4 py-2 font-medium">Lote</th>
              <th scope="col" class="px-4 py-2 font-medium">Fecha</th>
              <th scope="col" class="px-4 py-2 font-medium">Por tipo de envase</th>
              <th scope="col" class="px-4 py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr v-for="batch in report.data.value.batches" :key="batch.id">
              <td class="px-4 py-3 font-medium text-highlighted">{{ batch.code }}</td>
              <td class="px-4 py-3 tabular-nums">{{ formatCalendarDay(batch.date) }}</td>
              <td class="px-4 py-3">
                {{
                  batch.items
                    .map((item) => `${item.producedQty} × ${item.containerType.name}`)
                    .join(", ")
                }}
              </td>
              <td class="px-4 py-3 text-right tabular-nums">{{ batch.total }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </ReportState>
  </AppPage>
</template>
