<script setup lang="ts">
import { PRODUCTION_BATCHES_MAX_LIMIT, formatCalendarDay } from "@yacco/shared";
import type { ContainerType, Page, ProductionBatch, Route, RouteLoad } from "@yacco/shared";
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
const loadsPath = computed(() => `/routes/${props.route.id}/loads`);

const loads = ref<RouteLoad[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);
const batches = ref<ProductionBatch[]>([]);
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
}
onMounted(reload);

const editable = computed(
  () => props.route.status === "PLANNED" || props.route.status === "IN_PROGRESS",
);
// La API sólo deja corregir una carga con la ruta PLANNED: con el camión en la
// calle, un error de carga se resuelve en la liquidación.
const canRemove = computed(() => props.route.status === "PLANNED");

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

const typeItems = computed(() =>
  containerTypes.items.value.map((type) => ({ label: type.name, value: type.id })),
);

/** Lo que va arriba del camión, sumado por tipo de envase. */
const onBoard = computed(() => {
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
  <SectionCard
    title="Carga del camión"
    :description="
      canRemove
        ? 'Lo que sube sale siempre del lote más antiguo con unidades. Mientras la ruta no arranque se puede corregir; después ya no.'
        : 'Lo que sube sale siempre del lote más antiguo con unidades.'
    "
  >
    <div class="space-y-5">
      <div v-if="onBoard.length > 0" class="flex flex-wrap gap-2" aria-label="Arriba del camión">
        <span class="text-sm font-medium text-muted">Arriba del camión:</span>
        <UBadge
          v-for="entry in onBoard"
          :key="entry.name"
          color="primary"
          variant="subtle"
          :label="`${entry.quantity} × ${entry.name}`"
        />
      </div>

      <form
        v-if="editable"
        class="grid gap-4 rounded-md bg-elevated p-4 sm:grid-cols-[1fr_10rem_auto] sm:items-start"
        novalidate
        aria-label="Cargar el camión"
        @submit.prevent="submit"
      >
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
        <UButton
          type="submit"
          class="sm:mt-6"
          icon="i-lucide-package-plus"
          :disabled="submitting"
          :label="submitting ? 'Cargando…' : 'Cargar al camión'"
        />
        <p
          v-if="plan && requested !== null && plan.lines.length > 0"
          class="text-sm text-muted sm:col-span-3"
        >
          Sale de: {{ describePlan(plan.lines) }}
        </p>
      </form>

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
        <table class="w-full text-sm">
          <caption class="sr-only">
            Lo cargado al camión, con el lote del que salió, el tipo de envase y la cantidad
          </caption>
          <thead class="text-left text-xs tracking-wide text-muted uppercase">
            <tr>
              <th scope="col" class="py-2 font-medium">Lote</th>
              <th scope="col" class="py-2 font-medium">Tipo de envase</th>
              <th scope="col" class="py-2 text-right font-medium">Cantidad</th>
              <th v-if="canRemove" scope="col" class="py-2">
                <span class="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr v-for="load in loads" :key="load.id">
              <td class="py-3 font-medium text-highlighted">{{ load.batchItem.batch.code }}</td>
              <td class="py-3">{{ load.batchItem.containerType.name }}</td>
              <td class="py-3 text-right tabular-nums">{{ load.quantity }}</td>
              <td v-if="canRemove" class="py-3 text-right">
                <div
                  v-if="removingId === load.id"
                  role="group"
                  :aria-label="`Confirmar corregir la carga del lote ${load.batchItem.batch.code}`"
                  class="flex flex-wrap items-center justify-end gap-2"
                >
                  <span class="text-muted">¿Quitar esta carga del camión?</span>
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
                    @click="remove(load)"
                  />
                </div>
                <UButton
                  v-else
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  label="Corregir"
                  :aria-label="`Corregir la carga del lote ${load.batchItem.batch.code}`"
                  :disabled="busyId !== null"
                  @click="removingId = load.id"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="!canRemove" class="text-sm text-muted">
          Con la ruta ya iniciada, una carga mal ingresada no se borra: la diferencia se registra al
          liquidar.
        </p>
      </template>
    </div>
  </SectionCard>
</template>
