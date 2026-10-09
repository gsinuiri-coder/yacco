<script setup lang="ts">
import type { ContainerInventoryItem, PlantCount } from "@yacco/shared";

useHead({ title: "Inventario de envases · Yacco" });

const resource = useApiResource<ContainerInventoryItem[]>("/container-movements/inventory");
const rows = computed(() => pivotInventory(resource.data.value ?? []));
const negativesByState = computed(() => negativeContainerTypesByState(rows.value));
const grandTotal = computed(() => rows.value.reduce((sum, row) => sum + row.total, 0));
/**
 * Vacío es que el libro no tiene filas, NUNCA que las cantidades sumen cero:
 * llenar un lote sin ingreso previo deja vacíos y llenos en planta que se
 * compensan a cero sobre filas reales. Una comprobación por suma escondería la
 * matriz (fue un bug de producción del web React).
 */
const isEmpty = computed(() => resource.data.value !== null && resource.data.value.length === 0);

const session = useSession();
const isAdmin = computed(() => session.hasRole("ADMIN"));
const counting = ref(false);
const lastCount = ref<string | null>(null);

function onCounted(count: PlantCount): void {
  counting.value = false;
  lastCount.value = describePlantCount(count);
  void resource.reload();
}
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
          v-for="(types, state) in negativesByState"
          :key="state"
          role="alert"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="`Hay ${types.join(', ')} en negativo en ${CONTAINER_STATE_LABEL[state]}: el sistema cuenta menos de cero.`"
        >
          <template #description>
            <template v-if="state === 'EMPTY_AT_PLANT'">
              Puede que falten anotar envases que entraron a la planta, o que el conteo no esté al
              día. Revise
              <ULink to="/container-movements" class="underline">Movimientos de envases</ULink> o
              <a href="#conteo-planta" class="underline">Conteo de la planta</a>.
            </template>
            <template v-else-if="state === 'FULL_AT_PLANT'">
              Puede que una salida se haya anotado dos veces. Revise el
              <a href="#conteo-planta" class="underline">Conteo de la planta</a>.
            </template>
            <template v-else>
              Puede que al liquidar o al corregir una visita se hayan contado más envases de los que
              el sistema tenía en el camión. Revise
              <ULink to="/routes" class="underline">Rutas</ULink>.
            </template>
          </template>
        </UAlert>

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

        <SectionCard
          v-if="isAdmin"
          id="conteo-planta"
          title="Conteo de la planta"
          description="Cuente en el galpón los vacíos o los llenos de un tipo de envase: el inventario pasa a decir lo contado."
        >
          <template #actions>
            <UButton
              v-if="!counting"
              icon="i-lucide-clipboard-check"
              label="Contar la planta"
              @click="
                counting = true;
                lastCount = null;
              "
            />
          </template>
          <PlantCountForm
            v-if="counting"
            :rows="rows"
            @cancel="counting = false"
            @registered="onCounted"
          />
          <UAlert
            v-else-if="lastCount"
            role="status"
            color="success"
            variant="subtle"
            icon="i-lucide-check"
            :title="lastCount"
          />
          <p v-else class="text-sm text-muted">
            Los llenos que falten en planta se descuentan de los lotes, empezando por el más viejo.
            Los que sobren se anotan como lote en Producción.
          </p>
        </SectionCard>
      </div>
    </ResourceState>
  </AppPage>
</template>
