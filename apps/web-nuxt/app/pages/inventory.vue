<script setup lang="ts">
import { h } from "vue";
import type { ContainerInventoryItem, PlantCount } from "@yacco/shared";
import type { TableColumn } from "@nuxt/ui";
import InventoryQuantity from "../components/InventoryQuantity.vue";

useHead({ title: "Inventario de envases · Yacco" });

const columns: TableColumn<InventoryRow>[] = [
  { accessorKey: "containerTypeName", header: "Tipo de envase" },
  ...CONTAINER_STATES.map((state): TableColumn<InventoryRow> => ({
    id: state,
    header: CONTAINER_STATE_LABEL[state],
    meta: RIGHT_ALIGNED,
    cell: ({ row }) => h(InventoryQuantity, { value: row.original.byState[state] }),
  })),
  {
    id: "total",
    header: "Total",
    meta: RIGHT_ALIGNED,
    cell: ({ row }) => h(InventoryQuantity, { value: row.original.total }),
  },
];

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
const canCountPlant = computed(
  () => session.hasRole("ADMIN") || session.hasRole("PLANT_SUPERVISOR"),
);
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
      <UEmpty
        v-if="isEmpty"
        icon="i-lucide-package-open"
        title="Todavía no hay movimientos de envases"
        description="El inventario aparecerá aquí en cuanto se registre producción o entradas de envases."
      />

      <UPageBody v-else>
        <UAlert
          v-for="{ state, containerTypeNames } in negativesByState"
          :key="state"
          role="alert"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="`Hay ${containerTypeNames.join(', ')} en negativo en ${CONTAINER_STATE_LABEL[state]}: el sistema cuenta menos de cero.`"
        >
          <template #description>
            <template v-if="state === 'EMPTY_AT_PLANT'">
              Puede que falten anotar envases que entraron a la planta, o que el conteo no esté al
              día. Revisa
              <ULink to="/container-movements" class="underline">Movimientos de envases</ULink> o
              <a href="#plant-count" class="underline">Conteo de la planta</a>.
            </template>
            <template v-else-if="state === 'FULL_AT_PLANT'">
              Puede que una salida se haya anotado dos veces. Revisa el
              <a href="#plant-count" class="underline">Conteo de la planta</a>.
            </template>
            <template v-else>
              Puede que al liquidar o al corregir una visita se hayan contado más envases de los que
              el sistema tenía en el camión. Revisa
              <ULink to="/routes" class="underline">Rutas</ULink>.
            </template>
          </template>
        </UAlert>

        <UCard>
          <UTable
            :data="rows"
            :columns="columns"
            caption="Inventario de envases por tipo y estado"
          />
          <template #footer>
            <p>Total general: {{ grandTotal }} {{ grandTotal === 1 ? "envase" : "envases" }}</p>
          </template>
        </UCard>

        <SectionCard
          v-if="canCountPlant"
          id="plant-count"
          title="Conteo de la planta"
          description="Cuenta en el galpón los vacíos o los llenos de un tipo de envase: el inventario pasa a decir lo contado."
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
          <p v-else>
            Los llenos que falten en planta se descuentan de los lotes, empezando por el más viejo.
            Los que sobren se anotan como lote en Producción.
          </p>
        </SectionCard>
      </UPageBody>
    </ResourceState>
  </AppPage>
</template>
