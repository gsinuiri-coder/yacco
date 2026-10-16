<script setup lang="ts">
import { PRODUCTION_BATCHES_MAX_LIMIT, formatCalendarDay } from "@yacco/shared";
import type {
  ContainerType,
  Page,
  ProductionBatch,
  Route,
  RouteLoad,
  RouteTruckStockLine,
} from "@yacco/shared";
import type { TableColumn } from "@nuxt/ui";
import type { LoadPlanLine } from "../utils/fifo-load";

/**
 * La carga del camión. La oficina dice qué tipo de envase y cuántas unidades;
 * de qué lotes salen lo decide el reparto FIFO (utils/fifo-load.ts), y se
 * muestra antes de enviar.
 *
 * Una carga que abarca dos lotes son dos POST, uno por lote: la API registra
 * una carga y un movimiento ROUTE_LOAD por llamada, y esa correspondencia es
 * lo que después deja revertir una carga sin ambigüedad. Si el segundo POST
 * falla, el primero queda registrado y a la vista.
 */
const props = defineProps<{ route: Route }>();

const api = useApi();
const session = useSession();
const loadsPath = computed(() => `/routes/${props.route.id}/loads`);

const loads = ref<RouteLoad[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);
const batches = ref<ProductionBatch[]>([]);
const truckStock = ref<RouteTruckStockLine[]>([]);
const containerTypes = useCatalog<ContainerType>("/container-types");

async function reload(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    loads.value = await api.request<RouteLoad[]>(loadsPath.value);
  } catch (error) {
    loadError.value = describeApiFailure(error);
  } finally {
    loading.value = false;
  }
  // Lotes con stock, del más antiguo al más nuevo: la primera página son SIEMPRE
  // los más viejos con unidades, que es de donde consume FIFO.
  try {
    const page = await api.request<Page<ProductionBatch>>("/production-batches", {
      query: { withStock: true, limit: PRODUCTION_BATCHES_MAX_LIMIT },
    });
    batches.value = page.data;
  } catch {
    batches.value = [];
  }
  // Lo que queda arriba solo cambia con la ruta en la calle; planificada, es lo
  // cargado. Si no se puede leer, no se muestra: nunca un número inventado.
  if (props.route.status === "PLANNED") {
    truckStock.value = [];
    return;
  }
  try {
    truckStock.value = await api.request<RouteTruckStockLine[]>(
      `/routes/${props.route.id}/truck-stock`,
    );
  } catch {
    truckStock.value = [];
  }
}
onMounted(reload);

const canManageLoads = computed(() => session.hasRole("ADMIN") || session.hasRole("SELLER"));
const editable = computed(() => canManageLoads.value && props.route.status === "PLANNED");
// La API sólo deja corregir una carga con la ruta PLANNED: con el camión en la
// calle, un error de carga se resuelve en la liquidación.
const canRemove = computed(() => canManageLoads.value && props.route.status === "PLANNED");
const sectionDescription = computed(() => {
  if (props.route.status === "PLANNED") {
    return canManageLoads.value
      ? "Lo que sube sale siempre del lote más antiguo con unidades. Mientras la ruta no arranque se puede corregir; después ya no."
      : "Lo que sube sale siempre del lote más antiguo con unidades.";
  }
  return "Lo que subió salió siempre del lote más antiguo con unidades.";
});

const containerTypeId = ref<string | undefined>(undefined);
const quantity = ref("");
const validationError = ref<string | null>(null);
const submitError = ref<string | null>(null);
const submitting = ref(false);

watch([containerTypeId, quantity], () => {
  validationError.value = null;
});

const requested = computed(() => positiveWhole(quantity.value));
const plan = computed(() =>
  containerTypeId.value === undefined
    ? null
    : planFifoLoad(batches.value, containerTypeId.value, requested.value ?? 0),
);

function describePlan(lines: LoadPlanLine[]): string {
  return lines
    .map((line) => `${line.quantity} del ${line.batchCode} (${formatCalendarDay(line.batchDate)})`)
    .join(", ");
}

const loadColumns = computed<TableColumn<RouteLoad>[]>(() => [
  { id: "batch", header: "Lote" },
  { id: "containerType", header: "Tipo de envase" },
  { accessorKey: "quantity", header: "Cantidad", meta: RIGHT_ALIGNED },
  ...(canRemove.value
    ? [{ id: "actions", header: hiddenHeader("Acciones"), meta: RIGHT_ALIGNED }]
    : []),
]);

const typeItems = computed(() =>
  containerTypes.items.value.map((type) => ({ label: type.name, value: type.id })),
);

/** Lo que se cargó al camión, sumado por tipo de envase. */
const loadedByType = computed(() => {
  const byType = new Map<string, { name: string; quantity: number }>();
  for (const load of loads.value) {
    const current = byType.get(load.batchItem.containerTypeId);
    byType.set(load.batchItem.containerTypeId, {
      name: load.batchItem.containerType.name,
      quantity: (current?.quantity ?? 0) + load.quantity,
    });
  }
  return [...byType.values()].sort((a, b) => a.name.localeCompare(b.name));
});

async function submit(): Promise<void> {
  if (submitting.value) return;
  if (containerTypeId.value === undefined) {
    validationError.value = "Elige qué tipo de envase sube al camión";
    return;
  }
  if (requested.value === null) {
    validationError.value = "La cantidad debe ser un número entero mayor que 0";
    return;
  }
  const current = plan.value;
  if (current === null || current.shortfall > 0) {
    validationError.value = `En la planta hay ${current?.available ?? 0} disponibles de ese envase; no alcanzan para ${requested.value}`;
    return;
  }

  submitting.value = true;
  submitError.value = null;
  try {
    for (const line of current.lines) {
      await api.request<RouteLoad>(loadsPath.value, {
        method: "POST",
        body: { batchItemId: line.batchItemId, quantity: line.quantity },
      });
    }
    quantity.value = "";
  } catch (error) {
    // El 400 nombra el problema (stock, ruta terminada). Lo que sí llegó a
    // registrarse tiene que verse: se recarga igual.
    submitError.value = describeApiFailure(error);
  } finally {
    submitting.value = false;
    await reload();
  }
}

const removingId = ref<string | null>(null);
const busyId = ref<string | null>(null);

async function remove(load: RouteLoad): Promise<void> {
  if (busyId.value !== null) return;
  busyId.value = load.id;
  submitError.value = null;
  try {
    await api.request<void>(`${loadsPath.value}/${load.id}`, { method: "DELETE" });
    removingId.value = null;
    await reload();
  } catch (error) {
    submitError.value = describeApiFailure(error);
    removingId.value = null;
  } finally {
    busyId.value = null;
  }
}
</script>

<template>
  <SectionCard title="Carga del camión" :description="sectionDescription">
    <UPageList>
      <div
        v-if="loadedByType.length > 0"
        role="group"
        class="flex flex-wrap items-center gap-2"
        aria-label="Cargado en el camión"
      >
        <span>Cargado:</span>
        <UBadge
          v-for="entry in loadedByType"
          :key="entry.name"
          color="neutral"
          variant="subtle"
          :label="`${entry.quantity} × ${entry.name}`"
        />
      </div>
      <div
        v-if="truckStock.length > 0"
        role="group"
        class="flex flex-wrap items-center gap-2"
        aria-label="Queda arriba del camión"
      >
        <span>Queda arriba:</span>
        <UBadge
          v-for="line in truckStock"
          :key="line.containerType.id"
          color="primary"
          variant="subtle"
          :label="`${line.onBoard} × ${line.containerType.name}`"
        />
      </div>

      <UPageCard v-if="editable" variant="soft">
        <UForm
          :state="{}"
          :validate-on="[]"
          :loading-auto="false"
          novalidate
          aria-label="Cargar el camión"
          @submit="submit"
        >
          <UPageGrid>
            <UFormField
              label="Tipo de envase"
              :help="plan ? `En la planta hay ${plan.available} disponibles.` : undefined"
            >
              <USelect
                v-model="containerTypeId"
                :items="typeItems"
                placeholder="Elige un tipo de envase"
                :disabled="submitting"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Cantidad">
              <UInput
                v-model="quantity"
                type="number"
                :min="1"
                :step="1"
                :disabled="submitting"
                class="w-full"
              />
            </UFormField>
          </UPageGrid>
          <UAlert
            v-if="plan && requested !== null && plan.lines.length > 0"
            color="neutral"
            variant="subtle"
            :title="`Sale de: ${describePlan(plan.lines)}`"
          />
          <div class="flex justify-end gap-2">
            <UButton
              type="submit"
              icon="i-lucide-package-plus"
              :disabled="submitting"
              :label="submitting ? 'Cargando…' : 'Cargar al camión'"
            />
          </div>
        </UForm>
      </UPageCard>

      <UAlert
        v-if="validationError"
        role="alert"
        color="error"
        variant="subtle"
        :title="validationError"
      />
      <UAlert v-if="submitError" role="alert" color="error" variant="subtle" :title="submitError" />

      <ListStatus
        v-if="loading || loadError || loads.length === 0"
        :error-message="loadError"
        :loading="loading"
        :empty="true"
        loading-label="Cargando lo que lleva el camión…"
        error-title="No se pudo cargar lo que lleva el camión"
        empty-icon="i-lucide-truck"
        empty-title="El camión todavía va vacío"
        :empty-description="
          editable
            ? 'Elige el tipo de envase y cuántas unidades suben; el sistema toma primero el lote más antiguo.'
            : 'Esta ruta salió sin carga registrada.'
        "
        @retry="reload"
      />

      <template v-else>
        <UTable
          :data="loads"
          :columns="loadColumns"
          caption="Lo cargado al camión, con el lote del que salió, el tipo de envase y la cantidad"
        >
          <template #batch-cell="{ row }">{{ row.original.batchItem.batch.code }}</template>
          <template #containerType-cell="{ row }">
            {{ row.original.batchItem.containerType.name }}
          </template>
          <template #actions-cell="{ row }">
            <div
              v-if="removingId === row.original.id"
              role="group"
              :aria-label="`Confirmar corregir la carga del lote ${row.original.batchItem.batch.code}`"
              class="flex flex-wrap items-center justify-end gap-2"
            >
              <span>¿Quitar esta carga del camión?</span>
              <UButton
                color="neutral"
                variant="outline"
                size="sm"
                label="No"
                :disabled="busyId !== null"
                @click="removingId = null"
              />
              <UButton
                color="error"
                size="sm"
                label="Sí, quitar"
                :disabled="busyId !== null"
                @click="remove(row.original)"
              />
            </div>
            <UButton
              v-else
              color="neutral"
              variant="ghost"
              size="sm"
              label="Corregir"
              :aria-label="`Corregir la carga del lote ${row.original.batchItem.batch.code}`"
              :disabled="busyId !== null"
              @click="removingId = row.original.id"
            />
          </template>
        </UTable>
        <UAlert
          v-if="route.status !== 'PLANNED'"
          color="neutral"
          variant="subtle"
          title="Con la ruta ya iniciada, una carga mal ingresada no se borra: la diferencia se registra al liquidar."
        />
      </template>
    </UPageList>
  </SectionCard>
</template>
