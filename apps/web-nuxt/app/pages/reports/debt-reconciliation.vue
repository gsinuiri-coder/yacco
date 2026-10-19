<script setup lang="ts">
import { formatSoles, isAboveZero } from "@yacco/shared";
import type { DebtReconciliation, DebtReconciliationDiscrepancy } from "@yacco/shared";
import type { TableColumn } from "@nuxt/ui";

/**
 * El cuadre de la deuda: la deuda que muestran las pantallas contra la que
 * sale de sumar, desde cero, las ventas no anuladas y restar los cobros
 * confirmados. Las dos cuentas las hace la API por caminos distintos a
 * propósito. Lo esperado es que coincidan, y ese estado se muestra como buena
 * noticia. Informa y no corrige.
 */
useHead({ title: "Cuadre de la deuda · Yacco" });

const report = useReport<DebtReconciliation>("/debt-reconciliation");

function describeDifference(discrepancy: DebtReconciliationDiscrepancy): string {
  const gap = formatSoles(discrepancy.difference.replace(/^-/, ""));
  return isAboveZero(discrepancy.difference)
    ? `A la deuda guardada le faltan ${gap}`
    : `La deuda guardada tiene ${gap} de más`;
}

const discrepancyColumns: TableColumn<DebtReconciliationDiscrepancy>[] = [
  { id: "customer", header: "Cliente" },
  { id: "ledgerBalance", header: "Según ventas y cobros", meta: RIGHT_ALIGNED },
  { id: "materializedBalance", header: "Deuda guardada", meta: RIGHT_ALIGNED },
  { id: "difference", header: "Diferencia" },
];
</script>

<template>
  <AppPage
    title="Cuadre de la deuda"
    description="Compara la deuda de cada cliente con sus ventas y cobros sumados desde cero. Informa y no corrige."
  >
    <ReportState
      :is-admin="report.isAdmin.value"
      :loading="report.loading.value"
      :slow="report.slow.value"
      :error-message="report.errorMessage.value"
      :empty="report.data.value?.discrepancies.length === 0"
      empty-title="Las dos cuentas coinciden"
      empty-description="La deuda de cada cliente es la que dicen sus ventas y cobros: la que muestran las pantallas es confiable."
      @retry="report.load"
    >
      <UPageBody v-if="report.data.value">
        <UAlert
          role="status"
          color="warning"
          variant="subtle"
          :title="
            report.data.value.discrepancyCount === 1
              ? 'Hay 1 cliente cuya deuda no coincide con sus ventas y cobros.'
              : `Hay ${report.data.value.discrepancyCount} clientes cuya deuda no coincide con sus ventas y cobros.`
          "
          description="Nada se corrigió: esto es lo que hay que revisar."
        />
        <UTable
          :data="report.data.value.discrepancies"
          :columns="discrepancyColumns"
          caption="Clientes cuya deuda no coincide con sus ventas y cobros"
        >
          <template #customer-cell="{ row }">
            {{ row.original.customerName ?? "Cliente desconocido" }}
          </template>
          <template #ledgerBalance-cell="{ row }">
            <MoneyAmount :value="row.original.ledgerBalance" debt />
          </template>
          <template #materializedBalance-cell="{ row }">
            <MoneyAmount :value="row.original.materializedBalance" debt />
          </template>
          <template #difference-cell="{ row }">{{ describeDifference(row.original) }}</template>
        </UTable>
      </UPageBody>
    </ReportState>
  </AppPage>
</template>
