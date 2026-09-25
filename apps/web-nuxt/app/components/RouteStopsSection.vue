<script setup lang="ts">
import { formatInstantInLima } from "@yacco/shared";
import type { Route, RouteStop } from "@yacco/shared";

const props = defineProps<{ route: Route }>();
const emit = defineEmits<{
  changed: [];
  /** El resumen lo pinta la página: la sección se desmonta mientras la ruta recarga. */
  marked: [outcome: { stopName: string; result: RouteStop } | null];
}>();

const api = useApi();
const session = useSession();

const editable = computed(
  () => props.route.status === "PLANNED" || props.route.status === "IN_PROGRESS",
);
// Marcar sólo con la ruta en curso: antes el camión no salió, después ya cerró.
// Es la misma regla que aplica RoutesService.markStop.
const canMark = computed(() => props.route.status === "IN_PROGRESS");
const stops = computed(() => props.route.stops);
/**
 * Corregir una parada ya registrada (HU-24): solo ADMIN, y solo con la ruta ya
 * en la calle o cerrada. Planificada no tiene nada registrado que corregir.
 */
const canCorrect = computed(() => session.hasRole("ADMIN") && props.route.status !== "PLANNED");
const showActions = computed(() => editable.value || canCorrect.value);
const correcting = ref<RouteStop | null>(null);

const adding = ref(false);
// Armar la hoja de una vez: solo con la ruta planificada, y solo la oficina
// (la API lo limita a ADMIN y SELLER). En la calle se agrega de a una.
const canBatch = computed(
  () => props.route.status === "PLANNED" && (session.hasRole("ADMIN") || session.hasRole("SELLER")),
);
const batching = ref(false);
const marking = ref<RouteStop | null>(null);
const removingId = ref<string | null>(null);
const busyId = ref<string | null>(null);
const stopError = ref<string | null>(null);

/**
 * Mover una parada es reordenar la ruta entera: el PATCH toma la lista
 * COMPLETA. Subir y bajar en vez de arrastrar: se opera con teclado, en
 * pantallas chicas, y cada movimiento se puede decir en voz alta.
 */
async function move(index: number, direction: -1 | 1): Promise<void> {
  const target = index + direction;
  if (target < 0 || target >= stops.value.length || busyId.value !== null) return;
  const ids = stops.value.map((stop) => stop.id);
  const moved = ids[index]!;
  ids[index] = ids[target]!;
  ids[target] = moved;

  busyId.value = moved;
  stopError.value = null;
  try {
    await api.request<Route>(`/routes/${props.route.id}/stops/reorder`, {
      method: "PATCH",
      body: { stopIds: ids },
    });
    emit("changed");
  } catch (error) {
    stopError.value = describeApiFailure(error);
  } finally {
    busyId.value = null;
  }
}

async function remove(stop: RouteStop): Promise<void> {
  if (busyId.value !== null) return;
  busyId.value = stop.id;
  stopError.value = null;
  try {
    await api.request<void>(`/routes/${props.route.id}/stops/${stop.id}`, { method: "DELETE" });
    removingId.value = null;
    emit("changed");
  } catch (error) {
    stopError.value = describeApiFailure(error);
    removingId.value = null;
  } finally {
    busyId.value = null;
  }
}

function startMarking(stop: RouteStop): void {
  marking.value = stop;
  stopError.value = null;
  emit("marked", null);
}

function startCorrecting(stop: RouteStop): void {
  marking.value = null;
  correcting.value = stop;
  stopError.value = null;
  emit("marked", null);
}

function correctionDone(result: RouteStop): void {
  const stop = correcting.value!;
  emit("marked", { stopName: stop.location.customer.name, result });
  correcting.value = null;
  emit("changed");
}

function markDone(result: RouteStop): void {
  const stop = marking.value!;
  emit("marked", { stopName: stop.location.customer.name, result });
  marking.value = null;
  emit("changed");
}
</script>

<template>
  <SectionCard title="Paradas" description="En el orden en que el chofer las va a visitar.">
    <template v-if="editable && !adding && !batching" #actions>
      <UButton
        v-if="canBatch"
        color="neutral"
        variant="outline"
        icon="i-lucide-list-checks"
        label="Agregar pedidos pendientes"
        @click="
          batching = true;
          stopError = null;
        "
      />
      <UButton
        icon="i-lucide-map-pin-plus"
        label="Agregar parada"
        @click="
          adding = true;
          stopError = null;
        "
      />
    </template>

    <div class="space-y-4">
      <div v-if="batching" class="rounded-md bg-elevated p-4">
        <RouteBatchStopsForm
          :route="route"
          @cancel="batching = false"
          @added="
            batching = false;
            emit('changed');
          "
        />
      </div>

      <div v-if="adding" class="rounded-md bg-elevated p-4">
        <RouteStopAddForm
          :route-id="route.id"
          @cancel="adding = false"
          @added="
            adding = false;
            emit('changed');
          "
        />
      </div>

      <div v-if="marking" class="rounded-md border border-primary/40 bg-primary/5 p-4">
        <h3 class="text-base font-semibold text-highlighted">
          Parada {{ marking.position }}: {{ marking.location.customer.name }}
        </h3>
        <p class="mb-4 text-sm text-muted">
          {{ marking.location.name }} · {{ marking.location.address }}
        </p>
        <RouteStopMarkForm
          :route-id="route.id"
          :stop="marking"
          @cancel="marking = null"
          @marked="markDone"
        />
      </div>

      <div v-if="correcting" class="rounded-md border border-warning/40 bg-warning/5 p-4">
        <h3 class="text-base font-semibold text-highlighted">
          Corregir la parada {{ correcting.position }}: {{ correcting.location.customer.name }}
        </h3>
        <p class="mb-4 text-sm text-muted">
          Lo anotado se anula con el motivo que escribas y sigue visible; se registra de nuevo con
          estos datos.
        </p>
        <RouteStopMarkForm
          :route-id="route.id"
          :stop="correcting"
          correction
          @cancel="correcting = null"
          @marked="correctionDone"
        />
      </div>

      <UAlert v-if="stopError" role="alert" color="error" variant="subtle" :title="stopError" />

      <ListStatus
        v-if="stops.length === 0"
        :error-message="null"
        :loading="false"
        :empty="true"
        loading-label=""
        empty-icon="i-lucide-map-pin"
        empty-title="Esta ruta todavía no tiene paradas"
        :empty-description="
          editable
            ? 'Agrega los pedidos que va a entregar el chofer, o un cliente al que le vas a vender en la calle.'
            : 'Esta ruta terminó sin paradas: nunca se le agregó ninguna.'
        "
      />

      <div v-else class="overflow-x-auto">
        <table class="w-full text-sm">
          <caption class="sr-only">
            Paradas de la ruta con su orden, cliente, dirección, origen y estado, incluida la
            corrección de la parada cuando la hubo
          </caption>
          <thead class="text-left text-xs tracking-wide text-muted uppercase">
            <tr>
              <th scope="col" class="w-12 py-2 font-medium">Orden</th>
              <th scope="col" class="py-2 font-medium">Cliente</th>
              <th scope="col" class="py-2 font-medium">Origen</th>
              <th scope="col" class="py-2 font-medium">Estado</th>
              <th v-if="showActions" scope="col" class="py-2">
                <span class="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr v-for="(stop, index) in stops" :key="stop.id" class="align-top">
              <td class="py-3">
                <span
                  class="grid size-7 place-items-center rounded-full bg-elevated text-xs font-semibold tabular-nums"
                  >{{ stop.position }}</span
                >
              </td>
              <td class="py-3">
                <p class="font-medium text-highlighted">{{ stop.location.customer.name }}</p>
                <!-- El nombre de la locación casi siempre es "Principal"; sólo
                     distingue algo cuando el cliente tiene más de un punto. -->
                <p class="text-muted">{{ stop.location.name }} · {{ stop.location.address }}</p>
              </td>
              <td class="py-3">{{ STOP_ORIGIN[stop.origin] }}</td>
              <td class="space-y-1 py-3">
                <div class="flex flex-wrap gap-1.5">
                  <UBadge
                    :color="STOP_STATUS[stop.status].color"
                    variant="subtle"
                    :label="STOP_STATUS[stop.status].label"
                  />
                  <UBadge
                    v-if="stop.correction !== null"
                    color="info"
                    variant="soft"
                    label="Corregida"
                  />
                </div>
                <!-- El motivo va condicionado al ESTADO, no a que exista: una
                     parada corregida de FAILED a DELIVERED conserva su motivo de
                     falla original a propósito (es la evidencia del error de
                     anotación, así lo advierte la API). Sin esta condición la
                     fila se lee "Entregada / Nadie atendió". No lo "arregles"
                     borrando el motivo del lado de la API. -->
                <p v-if="stop.status === 'FAILED' && stop.failureReason" class="text-muted">
                  {{ stop.failureReason }}
                </p>
                <template v-if="stop.correction !== null">
                  <p class="text-muted">
                    Corregida el {{ formatInstantInLima(stop.correction.correctedAt) }} por
                    {{ stop.correction.correctedBy.name }}
                  </p>
                  <p v-if="stop.correction.correctionReason !== null" class="text-muted">
                    Motivo: {{ stop.correction.correctionReason }}
                  </p>
                </template>
              </td>
              <td v-if="showActions" class="py-3 text-right">
                <div
                  v-if="removingId === stop.id"
                  role="group"
                  :aria-label="`Confirmar quitar a ${stop.location.customer.name}`"
                  class="flex flex-wrap items-center justify-end gap-2"
                >
                  <span class="text-muted">¿Quitar esta parada?</span>
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
                    @click="remove(stop)"
                  />
                </div>
                <div v-else class="flex flex-wrap justify-end gap-1">
                  <UButton
                    v-if="canMark && stop.status === 'PENDING'"
                    size="sm"
                    label="Registrar"
                    :aria-label="`Registrar la parada de ${stop.location.customer.name}`"
                    :disabled="busyId !== null"
                    @click="startMarking(stop)"
                  />
                  <UButton
                    v-if="canCorrect && stop.status !== 'PENDING'"
                    color="neutral"
                    variant="outline"
                    size="sm"
                    label="Corregir"
                    :aria-label="`Corregir la parada de ${stop.location.customer.name}`"
                    :disabled="busyId !== null"
                    @click="startCorrecting(stop)"
                  />
                  <UButton
                    v-if="editable"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    icon="i-lucide-arrow-up"
                    :aria-label="`Subir la parada de ${stop.location.customer.name}`"
                    :disabled="index === 0 || busyId !== null"
                    @click="move(index, -1)"
                  />
                  <UButton
                    v-if="editable"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    icon="i-lucide-arrow-down"
                    :aria-label="`Bajar la parada de ${stop.location.customer.name}`"
                    :disabled="index === stops.length - 1 || busyId !== null"
                    @click="move(index, 1)"
                  />
                  <!-- Una parada resuelta tiene venta y movimientos colgando: la
                       API no deja quitarla y acá ni se ofrece. -->
                  <UButton
                    v-if="editable && stop.status === 'PENDING'"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    icon="i-lucide-trash-2"
                    :aria-label="`Quitar la parada de ${stop.location.customer.name}`"
                    :disabled="busyId !== null"
                    @click="removingId = stop.id"
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </SectionCard>
</template>
