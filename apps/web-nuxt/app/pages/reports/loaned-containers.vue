<script setup lang="ts">
import type { LoanedContainersReport } from "@yacco/shared";
import type { TableColumn } from "@nuxt/ui";

/**
 * HU-20: los envases en poder de cada cliente, por tipo. El total por tipo es
 * el mismo número que «En poder de clientes» del inventario: salen de dos
 * cuentas distintas (el saldo por cliente y el libro), y un test de la API
 * comprueba que coincidan. Un saldo negativo se muestra: devolvió más de lo
 * que el sistema sabía que tenía.
 */
useHead({ title: "Envases prestados · Yacco" });

const report = useReport<LoanedContainersReport>("/reports/loaned-containers");

const loanColumns: TableColumn<LoanedContainersReport["rows"][number]>[] = [
  { id: "customer", accessorFn: (row) => row.customer.name, header: "Cliente" },
  { id: "containerType", accessorFn: (row) => row.containerType.name, header: "Tipo de envase" },
  { id: "quantity", header: "Tiene", meta: RIGHT_ALIGNED },
];
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
      empty-description="Aparecen acá cuando se le dejan bidones prestados a un cliente o un conteo encuentra envases en su ubicación."
      @retry="report.load"
    >
      <UPageBody v-if="report.data.value">
        <!-- UPageGrid como `dl`: StatTile pinta dt/dd, que sólo valen dentro de una. -->
        <UPageGrid as="dl">
          <StatTile label="Total prestado" :value="report.data.value.total" />
          <StatTile
            v-for="line in report.data.value.byType"
            :key="line.containerType.id"
            :label="line.containerType.name"
            :value="line.quantity"
          />
        </UPageGrid>
        <UTable
          :data="report.data.value.rows"
          :columns="loanColumns"
          caption="Envases en poder de cada cliente, por tipo de envase"
        >
          <template #quantity-cell="{ row }">
            <p>{{ row.original.quantity }}</p>
            <UBadge
              v-if="row.original.quantity < 0"
              color="error"
              variant="subtle"
              label="devolvió más de lo registrado"
            />
          </template>
        </UTable>
      </UPageBody>
    </ReportState>
  </AppPage>
</template>
