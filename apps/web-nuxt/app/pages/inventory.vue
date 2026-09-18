<script setup lang="ts">
import type { ContainerInventoryItem } from "@yacco/shared";

useHead({ title: "Inventario de envases · Yacco" });

const resource = useApiResource<ContainerInventoryItem[]>("/container-movements/inventory");
const rows = computed(() => pivotInventory(resource.data.value ?? []));
const grandTotal = computed(() => rows.value.reduce((sum, row) => sum + row.total, 0));
/**
 * Vacío es que el libro no tiene filas, NUNCA que las cantidades sumen cero:
 * llenar un lote sin ingreso previo deja vacíos y llenos en planta que se
 * compensan a cero sobre filas reales. Una comprobación por suma escondería la
 * matriz (fue un bug de producción del web React).
 */
const isEmpty = computed(() => resource.data.value !== null && resource.data.value.length === 0);
</script>

<template>
  <AppPage
    title="Inventario de envases"
    description="El total son los envases de la empresa: todo lo que entró menos lo que salió por venta, daño o pérdida."
  >
    <ResourceState
      :loading="resource.loading.value"
      :slow="resource.slow.value"
      :not-found="false"
      :error-message="resource.errorMessage.value"
      noun="inventario"
      article="el"
      back-to="/"
      back-label="Volver al panel"
      @retry="resource.reload"
    >
      <UCard v-if="isEmpty">
        <div class="flex flex-col items-center gap-3 py-10 text-center">
          <UIcon name="i-lucide-package-open" class="size-8 text-dimmed" aria-hidden="true" />
          <p class="font-medium text-highlighted">Todavía no hay movimientos de envases</p>
          <p class="max-w-md text-muted">
            El inventario aparecerá aquí en cuanto se registre producción o entradas de envases.
          </p>
        </div>
      </UCard>

      <div v-else class="space-y-4">
        <UAlert
          v-if="hasNegative(rows)"
          role="alert"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="Hay valores negativos: se registraron más envases llenados que vacíos disponibles. Faltan registrar entradas de envases."
        />

        <UCard :ui="{ body: 'p-0 sm:p-0' }">
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <caption class="sr-only">
                Inventario de envases por tipo y estado
              </caption>
              <thead class="bg-elevated text-xs tracking-wide text-muted uppercase">
                <tr>
                  <th scope="col" class="px-4 py-3 text-left font-medium">Tipo de envase</th>
                  <th
                    v-for="state in CONTAINER_STATES"
                    :key="state"
                    scope="col"
                    class="px-4 py-3 text-right font-medium"
                  >
                    {{ CONTAINER_STATE_LABEL[state] }}
                  </th>
                  <th scope="col" class="px-4 py-3 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-default">
                <tr v-for="row in rows" :key="row.containerTypeId">
                  <th scope="row" class="px-4 py-3 text-left font-medium text-highlighted">
                    {{ row.containerTypeName }}
                  </th>
                  <td
                    v-for="state in CONTAINER_STATES"
                    :key="state"
                    class="px-4 py-3 text-right tabular-nums"
                  >
                    <InventoryQuantity :value="row.byState[state]" />
                  </td>
                  <td class="px-4 py-3 text-right font-semibold tabular-nums">
                    <InventoryQuantity :value="row.total" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="border-t border-default px-4 py-3 text-right text-muted">
            Total general:
            <span class="ml-1 font-display text-lg font-semibold text-highlighted tabular-nums">{{
              grandTotal
            }}</span>
            {{ grandTotal === 1 ? "envase" : "envases" }}
          </p>
        </UCard>
      </div>
    </ResourceState>
  </AppPage>
</template>
