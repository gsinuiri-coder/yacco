<script setup lang="ts">
import { formatCalendarDay, formatSoles } from "@yacco/shared";
import type { CustomerDebtsReport } from "@yacco/shared";

/**
 * HU-19: a quién cobrarle primero. La deuda de cada cliente y desde cuándo
 * debe: el cargo más antiguo desde la última vez que estuvo al día (supuesto
 * 12 de supuestos-por-validar.md: el sistema no reparte cobros entre ventas).
 */
useHead({ title: "Deuda por cliente · Yacco" });

const report = useReport<CustomerDebtsReport>("/reports/debt");
</script>

<template>
  <AppPage
    title="Deuda por cliente"
    description="Quién debe, cuánto y desde cuándo. Para decidir a quién cobrarle primero."
  >
    <ReportState
      :is-admin="report.isAdmin.value"
      :loading="report.loading.value"
      :slow="report.slow.value"
      :error-message="report.errorMessage.value"
      :empty="report.data.value?.rows.length === 0"
      empty-title="Nadie debe"
      empty-description="Todos los clientes están al día."
      @retry="report.load"
    >
      <table v-if="report.data.value" class="w-full text-sm">
        <caption class="sr-only">
          Deuda de cada cliente, con la fecha del cargo más antiguo
        </caption>
        <thead class="text-left text-xs tracking-wide text-muted uppercase">
          <tr>
            <th scope="col" class="px-4 py-2 font-medium">Cliente</th>
            <th scope="col" class="px-4 py-2 font-medium">Zona</th>
            <th scope="col" class="px-4 py-2 font-medium">Debe desde</th>
            <th scope="col" class="px-4 py-2 text-right font-medium">Deuda</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-default">
          <tr v-for="row in report.data.value.rows" :key="row.customer.id">
            <td class="px-4 py-3 font-medium text-highlighted">
              <NuxtLink :to="`/customers/${row.customer.id}`" class="hover:underline">
                {{ row.customer.name }}
              </NuxtLink>
            </td>
            <td class="px-4 py-3">{{ row.zone?.name ?? "Sin zona" }}</td>
            <td class="px-4 py-3 tabular-nums">{{ formatCalendarDay(row.oldestChargeDate) }}</td>
            <td class="px-4 py-3 text-right tabular-nums">{{ formatSoles(row.debt) }}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr class="border-t border-default font-medium text-highlighted">
            <th scope="row" colspan="3" class="px-4 py-3 text-left">Total por cobrar</th>
            <td class="px-4 py-3 text-right tabular-nums">
              {{ formatSoles(report.data.value.total) }}
            </td>
          </tr>
        </tfoot>
      </table>
    </ReportState>
  </AppPage>
</template>
