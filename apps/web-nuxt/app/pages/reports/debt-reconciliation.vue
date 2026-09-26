<script setup lang="ts">
import { formatSoles, isAboveZero } from "@yacco/shared";
import type { DebtReconciliation, DebtReconciliationDiscrepancy } from "@yacco/shared";

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
      <div v-if="report.data.value" class="space-y-4">
        <UAlert
          role="status"
          color="warning"
          variant="subtle"
          class="rounded-none"
          :title="
            report.data.value.discrepancyCount === 1
              ? 'Hay 1 cliente cuya deuda no coincide con sus ventas y cobros.'
              : `Hay ${report.data.value.discrepancyCount} clientes cuya deuda no coincide con sus ventas y cobros.`
          "
          description="Nada se corrigió: esto es lo que hay que revisar."
        />
        <table class="w-full text-sm">
          <caption class="sr-only">
            Clientes cuya deuda no coincide con sus ventas y cobros
          </caption>
          <thead class="text-left text-xs tracking-wide text-muted uppercase">
            <tr>
              <th scope="col" class="px-4 py-2 font-medium">Cliente</th>
              <th scope="col" class="px-4 py-2 text-right font-medium">Según ventas y cobros</th>
              <th scope="col" class="px-4 py-2 text-right font-medium">Deuda guardada</th>
              <th scope="col" class="px-4 py-2 font-medium">Diferencia</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr
              v-for="discrepancy in report.data.value.discrepancies"
              :key="discrepancy.customerId ?? 'sin-cliente'"
            >
              <td class="px-4 py-3 font-medium text-highlighted">
                {{ discrepancy.customerName ?? "Cliente desconocido" }}
              </td>
              <td class="px-4 py-3 text-right">
                <MoneyAmount :value="discrepancy.ledgerBalance" debt />
              </td>
              <td class="px-4 py-3 text-right">
                <MoneyAmount :value="discrepancy.materializedBalance" debt />
              </td>
              <td class="px-4 py-3">{{ describeDifference(discrepancy) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </ReportState>
  </AppPage>
</template>
