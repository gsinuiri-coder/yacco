<script setup lang="ts">
import { formatCalendarDay, formatSoles } from "@yacco/shared";
import type { CustomerDebtsReport } from "@yacco/shared";
import type { TableColumn } from "@nuxt/ui";

/**
 * HU-19: a quién cobrarle primero. La deuda de cada cliente y desde cuándo
 * debe: el cargo más antiguo desde la última vez que estuvo al día (supuesto
 * 13 de supuestos-por-validar.md: el sistema no reparte cobros entre ventas).
 * Si ese cargo es el saldo inicial del padrón, su fecha es la de corte y no
 * la de una venta: se dice «Saldo inicial» y la fecha va debajo, «al …»
 * (HU-19 E1 pide la fecha en cada fila).
 */
useHead({ title: "Deuda por cliente · Yacco" });

const report = useReport<CustomerDebtsReport>("/reports/debt");

const debtColumns: TableColumn<CustomerDebtsReport["rows"][number]>[] = [
  { id: "customer", header: "Cliente" },
  { id: "zone", header: "Zona" },
  { id: "oldestChargeDate", header: "Debe desde" },
  { id: "debt", header: "Deuda", meta: RIGHT_ALIGNED },
];
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
      <UTable
        v-if="report.data.value"
        :data="report.data.value.rows"
        :columns="debtColumns"
        caption="Deuda de cada cliente, con la fecha del cargo más antiguo, o del saldo inicial si la deuda viene de antes del sistema"
      >
        <template #customer-cell="{ row }">
          <ULink :to="`/customers/${row.original.customer.id}`">
            {{ row.original.customer.name }}
          </ULink>
        </template>
        <template #zone-cell="{ row }">{{ row.original.zone?.name ?? "Sin zona" }}</template>
        <template #oldestChargeDate-cell="{ row }">
          <template v-if="row.original.openedByOpeningBalance">
            <p>Saldo inicial</p>
            <p>al {{ formatCalendarDay(row.original.oldestChargeDate) }}</p>
          </template>
          <template v-else>{{ formatCalendarDay(row.original.oldestChargeDate) }}</template>
        </template>
        <template #debt-cell="{ row }">{{ formatSoles(row.original.debt) }}</template>
        <!-- No con `footer` de columna: UTable pinta el pie solo con <th>, y el
             total dejaría de leerse como el valor de «Total por cobrar». -->
        <template #body-bottom>
          <tr>
            <th scope="row" colspan="3" class="p-4 text-left">Total por cobrar</th>
            <td class="p-4 text-right">{{ formatSoles(report.data.value.total) }}</td>
          </tr>
        </template>
      </UTable>
    </ReportState>
  </AppPage>
</template>
