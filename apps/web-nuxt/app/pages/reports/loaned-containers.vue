<script setup lang="ts">
import type { LoanedContainersReport } from "@yacco/shared";

/**
 * HU-20: los envases en poder de cada cliente, por tipo. El total por tipo es
 * el mismo número que «En poder de clientes» del inventario: salen de dos
 * cuentas distintas (el saldo por cliente y el libro), y un test de la API
 * comprueba que coincidan. Un saldo negativo se muestra: devolvió más de lo
 * que el sistema sabía que tenía.
 */
useHead({ title: "Envases prestados · Yacco" });

const report = useReport<LoanedContainersReport>("/reports/loaned-containers");
</script>

<template>
  <AppPage
    title="Envases prestados"
    description="Cuántos envases tiene cada cliente, por tipo. Para saber a quién pedirle bidones."
  >
    <ReportState
      :is-admin="report.isAdmin.value"
      :loading="report.loading.value"
      :slow="report.slow.value"
      :error-message="report.errorMessage.value"
      :empty="report.data.value?.rows.length === 0"
      empty-title="Ningún cliente tiene envases prestados."
      empty-description="Aparecen acá cuando un cliente recibe bidones o cuando se cuentan en su ubicación."
      @retry="report.load"
    >
      <div v-if="report.data.value" class="space-y-6">
        <dl class="grid gap-3 p-4 sm:grid-cols-3">
          <StatTile label="Total prestado" :value="report.data.value.total" />
          <StatTile
            v-for="line in report.data.value.byType"
            :key="line.containerType.id"
            :label="line.containerType.name"
            :value="line.quantity"
          />
        </dl>
        <table class="w-full text-sm">
          <caption class="sr-only">
            Envases en poder de cada cliente, por tipo de envase
          </caption>
          <thead class="text-left text-xs tracking-wide text-muted uppercase">
            <tr>
              <th scope="col" class="px-4 py-2 font-medium">Cliente</th>
              <th scope="col" class="px-4 py-2 font-medium">Tipo de envase</th>
              <th scope="col" class="px-4 py-2 text-right font-medium">Tiene</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr
              v-for="row in report.data.value.rows"
              :key="`${row.customer.id}:${row.containerType.id}`"
            >
              <td class="px-4 py-3 font-medium text-highlighted">{{ row.customer.name }}</td>
              <td class="px-4 py-3">{{ row.containerType.name }}</td>
              <td class="px-4 py-3 text-right tabular-nums">
                {{ row.quantity }}
                <span v-if="row.quantity < 0" class="block text-xs text-error">
                  devolvió más de lo registrado
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </ReportState>
  </AppPage>
</template>
