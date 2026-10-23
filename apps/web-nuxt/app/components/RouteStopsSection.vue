<script setup lang="ts">
import { formatInstantInLima, isDeliveredDifferently } from "@yacco/shared";
import type { DeliveryLine, PlantLocation, Route, RoutePitStop, RouteStop } from "@yacco/shared";
import type { TableColumn } from "@nuxt/ui";
import { googleMapsLocationUrl } from "~/utils/customer-location";
import {
  buildGoogleMapsRouteLegs,
  proposeNearbyStopIds,
  proposePendingFromPlantStopIds,
} from "~/utils/route-planning";

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
const isOffice = computed(() => session.hasRole("ADMIN") || session.hasRole("SELLER"));
const canReorder = computed(() => editable.value && isOffice.value);
// Marcar sólo con la ruta en curso: antes el camión no salió, después ya cerró.
// Es la misma regla que aplica RoutesService.markStop.
const canMark = computed(() => props.route.status === "IN_PROGRESS");
const stops = computed(() => props.route.stops);

/**
 * «Pedido» y «entregado» de una parada de pedido ya entregada (fila 11), o
 * `null` si no hay qué comparar: una venta en ruta no tiene pedido y una
 * parada sin venta vigente no tiene entregado.
 */
function stopDelivery(
  stop: RouteStop,
): { ordered: string; delivered: string; different: boolean } | null {
  if (stop.orderedItems == null || stop.deliveredItems == null) return null;
  return {
    ordered: describeLines(stop.orderedItems),
    delivered: describeLines(stop.deliveredItems),
    different: isDeliveredDifferently(stop.orderedItems, stop.deliveredItems),
  };
}

function describeLines(lines: readonly DeliveryLine[]): string {
  if (lines.length === 0) return "nada";
  return lines.map((line) => `${line.quantity} ${line.product.name}`).join(", ");
}
/**
 * Corregir una parada ya registrada (HU-24): solo ADMIN, y solo con la ruta ya
 * en la calle o cerrada. Planificada no tiene nada registrado que corregir.
 */
const canCorrect = computed(() => session.hasRole("ADMIN") && props.route.status !== "PLANNED");
const showActions = computed(() => editable.value || canCorrect.value);
const stopColumns = computed<TableColumn<RouteStop>[]>(() => [
  { accessorKey: "position", header: "Orden" },
  { id: "customer", header: "Cliente" },
  { id: "origin", header: "Origen" },
  { id: "status", header: "Estado" },
  ...(showActions.value
    ? [{ id: "actions", header: hiddenHeader("Acciones"), meta: RIGHT_ALIGNED }]
    : []),
]);
const correcting = ref<RouteStop | null>(null);

const adding = ref(false);
// Armar la hoja en lote: ruta planificada o en curso, y solo la oficina
// (la API lo limita a ADMIN y SELLER).
const canBatch = computed(
  () =>
    (props.route.status === "PLANNED" || props.route.status === "IN_PROGRESS") &&
    (session.hasRole("ADMIN") || session.hasRole("SELLER")),
);
const batching = ref(false);
const marking = ref<RouteStop | null>(null);
const removingId = ref<string | null>(null);
const busyId = ref<string | null>(null);
const stopError = ref<string | null>(null);
const plantLocation = ref<PlantLocation | null>(null);
const plantLocationLoaded = ref(false);
const plantLocationFailure = ref<string | null>(null);
const plantLocationLoading = ref(false);
const routeToolsError = ref<string | null>(null);
const proposedStopIds = ref<string[] | null>(null);
/** «all»: la hoja entera desde la planta. «pending»: después de un pit, solo lo que falta. */
const proposalScope = ref<"all" | "pending">("all");
const ordering = ref(false);
let plantLocationRequest: Promise<void> | null = null;

const pendingStops = computed(() => stops.value.filter((stop) => stop.status === "PENDING"));
const proposedStops = computed(() => {
  if (proposedStopIds.value === null) return [];
  const byId = new Map(stops.value.map((stop) => [stop.id, stop]));
  return proposedStopIds.value.flatMap((id) => {
    const stop = byId.get(id);
    if (stop === undefined) return [];
    return proposalScope.value === "pending" && stop.status !== "PENDING" ? [] : [stop];
  });
});
const stopsWithoutLocation = computed(() =>
  stops.value.filter((stop) => stop.location.latitude === null || stop.location.longitude === null),
);
const proposedWithoutLocation = computed(() =>
  proposedStops.value.filter(
    (stop) => stop.location.latitude === null || stop.location.longitude === null,
  ),
);

/**
 * Fase 3, fila 10 (C.2): después de un pit el vehículo sale otra vez de la
 * planta. Solo cuenta un pit vigente: uno anulado no volvió a la planta.
 */
const activePits = ref(0);
const canProposeFromPlant = computed(
  () =>
    canReorder.value &&
    props.route.status === "IN_PROGRESS" &&
    activePits.value > 0 &&
    pendingStops.value.length > 1,
);
async function loadPits(): Promise<void> {
  if (!isOffice.value || props.route.status !== "IN_PROGRESS") return;
  try {
    const pits = await api.request<RoutePitStop[]>(`/routes/${props.route.id}/pit-stops`);
    activePits.value = pits.filter((pit) => pit.voidedAt === null).length;
  } catch {
    // Sin la lista de pits no se ofrece la propuesta; el resto de la hoja sigue igual.
    activePits.value = 0;
  }
}
watch(() => props.route, loadPits);
const mapLegs = computed(() => {
  if (plantLocation.value?.latitude === null || plantLocation.value?.longitude === null) return [];
  if (plantLocation.value === null) return [];
  return buildGoogleMapsRouteLegs(
    plantLocation.value,
    stops.value.map((stop) => ({
      id: stop.id,
      latitude: stop.location.latitude,
      longitude: stop.location.longitude,
    })),
  );
});

async function loadPlantLocation(): Promise<void> {
  if (plantLocationLoaded.value) return;
  if (plantLocationRequest !== null) return plantLocationRequest;
  plantLocationRequest = (async () => {
    plantLocationLoading.value = true;
    try {
      plantLocation.value = await api.request<PlantLocation>("/settings/plant-location");
    } catch (error) {
      plantLocationFailure.value = describeApiFailure(error);
    } finally {
      plantLocationLoading.value = false;
      plantLocationLoaded.value = true;
      plantLocationRequest = null;
    }
  })();
  return plantLocationRequest;
}

onMounted(() => {
  if (isOffice.value) void loadPlantLocation();
  void loadPits();
});

async function proposeNearbyOrder(scope: "all" | "pending" = "all"): Promise<void> {
  routeToolsError.value = null;
  if (plantLocationFailure.value !== null) {
    plantLocationLoaded.value = false;
    plantLocationFailure.value = null;
  }
  await loadPlantLocation();
  if (plantLocationFailure.value !== null) {
    routeToolsError.value = `No se pudo cargar la ubicación de la planta. ${plantLocationFailure.value}`;
    return;
  }
  const origin = plantLocation.value;
  if (origin?.latitude === null || origin?.longitude === null || origin === null) {
    routeToolsError.value =
      "Falta configurar la ubicación de la planta para ordenar las paradas por cercanía.";
    return;
  }
  const located = stops.value.map((stop) => ({
    id: stop.id,
    status: stop.status,
    latitude: stop.location.latitude,
    longitude: stop.location.longitude,
  }));
  proposalScope.value = scope;
  proposedStopIds.value =
    scope === "pending"
      ? proposePendingFromPlantStopIds(origin, located)
      : proposeNearbyStopIds(origin, located);
}

async function retryPlantLocation(): Promise<void> {
  plantLocation.value = null;
  plantLocationLoaded.value = false;
  plantLocationFailure.value = null;
  await loadPlantLocation();
}

async function applyProposedOrder(): Promise<void> {
  if (proposedStopIds.value === null || ordering.value) return;
  ordering.value = true;
  routeToolsError.value = null;
  try {
    await api.request<Route>(`/routes/${props.route.id}/stops/reorder`, {
      method: "PATCH",
      body: { stopIds: proposedStopIds.value },
    });
    proposedStopIds.value = null;
    emit("changed");
  } catch (error) {
    routeToolsError.value = describeApiFailure(error);
  } finally {
    ordering.value = false;
  }
}

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
      <div class="flex flex-wrap items-center justify-end gap-2">
        <UButton
          v-if="canReorder && stops.length > 1"
          color="neutral"
          variant="outline"
          icon="i-lucide-route"
          label="Ordenar por cercanía"
          :loading="ordering"
          :disabled="busyId !== null"
          @click="proposeNearbyOrder()"
        />
        <UButton
          v-if="canProposeFromPlant"
          color="neutral"
          variant="outline"
          icon="i-lucide-warehouse"
          label="Proponer orden desde la planta"
          :loading="ordering"
          :disabled="busyId !== null"
          @click="proposeNearbyOrder('pending')"
        />
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
      </div>
    </template>

    <UPageBody>
      <UPageCard v-if="batching" variant="soft">
        <RouteBatchStopsForm
          :route="route"
          @cancel="batching = false"
          @added="
            batching = false;
            emit('changed');
          "
        />
      </UPageCard>

      <UPageCard v-if="adding" variant="soft">
        <RouteStopAddForm
          :route-id="route.id"
          @cancel="adding = false"
          @added="
            adding = false;
            emit('changed');
          "
        />
      </UPageCard>

      <!-- El encabezado y la dirección van juntos en el slot #body: el título
           de UPageCard es un div, y el h3 tiene que nombrar el panel entero. -->
      <UPageCard v-if="marking" variant="subtle">
        <template #body>
          <h3 class="font-semibold text-highlighted">
            Parada {{ marking.position }}: {{ marking.location.customer.name }}
          </h3>
          <p>{{ marking.location.name }} · <LinkedText :text="marking.location.address" /></p>
        </template>
        <RouteStopMarkForm
          :route-id="route.id"
          :stop="marking"
          @cancel="marking = null"
          @marked="markDone"
        />
      </UPageCard>

      <UPageCard
        v-if="correcting"
        variant="subtle"
        description="Lo anotado se anula con el motivo que escribas y sigue visible; se registra de nuevo con estos datos."
      >
        <template #title>
          <h3>
            Corregir la parada {{ correcting.position }}: {{ correcting.location.customer.name }}
          </h3>
        </template>
        <RouteStopMarkForm
          :route-id="route.id"
          :stop="correcting"
          correction
          @cancel="correcting = null"
          @marked="correctionDone"
        />
      </UPageCard>

      <UAlert v-if="stopError" role="alert" color="error" variant="subtle" :title="stopError" />
      <UAlert
        v-if="routeToolsError"
        role="alert"
        color="error"
        variant="subtle"
        :title="routeToolsError"
      />

      <UPageCard
        v-if="proposedStopIds !== null"
        role="group"
        :aria-label="
          proposalScope === 'pending'
            ? 'Confirmar orden desde la planta'
            : 'Confirmar orden por cercanía'
        "
        variant="soft"
        :description="
          proposalScope === 'pending'
            ? 'Las paradas que faltan, empezando en la planta. Las ya registradas no se mueven.'
            : 'Revísalo antes de cambiar la hoja de ruta. La propuesta empieza en la planta.'
        "
      >
        <template #title><h3>Orden sugerido</h3></template>
        <UPageList as="ol">
          <UPageCard
            v-for="(stop, index) in proposedStops"
            :key="stop.id"
            as="li"
            variant="naked"
            :title="`${index + 1}. ${stop.location.customer.name}`"
            :description="`${stop.location.name} · ${stop.location.address}`"
          />
        </UPageList>
        <UAlert
          v-if="proposedWithoutLocation.length > 0"
          color="warning"
          variant="subtle"
          :title="`${proposedWithoutLocation.length} ${proposedWithoutLocation.length === 1 ? 'parada sin ubicación queda' : 'paradas sin ubicación quedan'} al final, en el orden actual.`"
        />
        <div class="flex flex-wrap items-center gap-2">
          <UButton label="Usar este orden" :loading="ordering" @click="applyProposedOrder" />
          <UButton
            color="neutral"
            variant="ghost"
            label="Cancelar"
            :disabled="ordering"
            @click="proposedStopIds = null"
          />
        </div>
      </UPageCard>

      <template v-if="isOffice && stops.length > 0 && plantLocationLoaded && mapLegs.length === 0">
        <UAlert
          v-if="plantLocationFailure !== null"
          color="neutral"
          variant="subtle"
          :title="`No se pudo preparar el recorrido. ${plantLocationFailure}`"
          :actions="[
            {
              label: 'Reintentar recorrido',
              color: 'neutral',
              variant: 'outline',
              size: 'sm',
              loading: plantLocationLoading,
              onClick: retryPlantLocation,
            },
          ]"
        />
        <UAlert
          v-else-if="
            plantLocation === null ||
            plantLocation.latitude === null ||
            plantLocation.longitude === null
          "
          color="neutral"
          variant="subtle"
          title="Configura la ubicación de la planta para abrir el recorrido en Maps."
        />
        <UAlert
          v-else
          color="neutral"
          variant="subtle"
          :title="`Ninguna parada entra al recorrido porque falta su ubicación. Completa la ubicación de ${stopsWithoutLocation.map((stop) => stop.location.customer.name).join(', ')}.`"
        />
      </template>

      <div v-if="mapLegs.length > 0" class="flex flex-wrap items-center gap-2">
        <UButton
          v-for="(leg, index) in mapLegs"
          :key="leg.url"
          :to="leg.url"
          target="_blank"
          rel="noopener noreferrer"
          color="neutral"
          variant="outline"
          icon="i-lucide-map"
          :label="
            mapLegs.length === 1
              ? 'Abrir recorrido en Maps'
              : `Abrir tramo ${index + 1} de ${mapLegs.length} en Maps`
          "
        />
      </div>
      <UAlert
        v-if="mapLegs.length > 0 && stopsWithoutLocation.length > 0"
        color="neutral"
        variant="subtle"
        :title="`${stopsWithoutLocation.map((stop) => stop.location.customer.name).join(', ')} ${stopsWithoutLocation.length === 1 ? 'no entra' : 'no entran'} al recorrido porque ${stopsWithoutLocation.length === 1 ? 'no tiene ubicación' : 'no tienen ubicación'}.`"
      />

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

      <UTable
        v-else
        :data="stops"
        :columns="stopColumns"
        :get-row-id="(stop) => stop.id"
        caption="Paradas de la ruta con su orden, cliente, dirección y referencia, origen y estado, incluida la corrección de la parada cuando la hubo"
      >
        <template #position-cell="{ row }">
          <UBadge color="neutral" variant="soft" :label="String(row.original.position)" />
        </template>
        <template #customer-cell="{ row }">
          <UPageCard variant="naked" :title="row.original.location.customer.name">
            <template #description>
              <!-- El nombre de la locación casi siempre es "Principal"; sólo
                   distingue algo cuando el cliente tiene más de un punto. -->
              <p>
                {{ row.original.location.name }} ·
                <LinkedText :text="row.original.location.address" />
              </p>
              <p v-if="row.original.location.addressReference">
                <LinkedText :text="row.original.location.addressReference" />
              </p>
            </template>
          </UPageCard>
        </template>
        <template #origin-cell="{ row }">{{ STOP_ORIGIN[row.original.origin] }}</template>
        <template #status-cell="{ row }">
          <UPageCard variant="naked">
            <template #title>
              <div class="flex flex-wrap items-center gap-2">
                <UBadge
                  :color="STOP_STATUS[row.original.status].color"
                  variant="subtle"
                  :label="STOP_STATUS[row.original.status].label"
                />
                <UBadge
                  v-if="row.original.correction !== null"
                  color="info"
                  variant="soft"
                  label="Corregida"
                />
                <UBadge
                  v-if="stopDelivery(row.original)?.different"
                  color="warning"
                  variant="soft"
                  label="Entregado distinto"
                />
              </div>
            </template>
            <template #description>
              <template v-if="stopDelivery(row.original)">
                <p>Pedido: {{ stopDelivery(row.original)?.ordered }}</p>
                <p>Entregado: {{ stopDelivery(row.original)?.delivered }}</p>
              </template>
              <!-- El motivo va condicionado al ESTADO, no a que exista: una
                   parada corregida de FAILED a DELIVERED conserva su motivo de
                   falla original a propósito (es la evidencia del error de
                   anotación, así lo advierte la API). Sin esta condición la
                   fila se lee "Entregada / Nadie atendió". No lo "arregles"
                   borrando el motivo del lado de la API. -->
              <p v-if="row.original.status === 'FAILED' && row.original.failureReason">
                {{ row.original.failureReason }}
              </p>
              <template v-if="row.original.correction !== null">
                <p>
                  Corregida el {{ formatInstantInLima(row.original.correction.correctedAt) }} por
                  {{ row.original.correction.correctedBy.name }}
                </p>
                <p v-if="row.original.correction.correctionReason !== null">
                  Motivo: {{ row.original.correction.correctionReason }}
                </p>
              </template>
            </template>
            <UButton
              v-if="
                isOffice &&
                row.original.markedLatitude !== null &&
                row.original.markedLongitude !== null
              "
              :to="googleMapsLocationUrl(row.original.markedLatitude, row.original.markedLongitude)"
              target="_blank"
              rel="noopener noreferrer"
              external
              color="neutral"
              variant="link"
              size="sm"
              icon="i-lucide-map-pin"
              label="Ver dónde se marcó"
            />
          </UPageCard>
        </template>
        <template #actions-cell="{ row }">
          <div
            v-if="removingId === row.original.id"
            role="group"
            :aria-label="`Confirmar quitar a ${row.original.location.customer.name}`"
            class="flex flex-wrap items-center justify-end gap-2"
          >
            <span>¿Quitar esta parada?</span>
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
          <div v-else class="flex flex-wrap items-center justify-end gap-2">
            <UButton
              v-if="canMark && row.original.status === 'PENDING'"
              size="sm"
              label="Registrar"
              :aria-label="`Registrar la parada de ${row.original.location.customer.name}`"
              :disabled="busyId !== null"
              @click="startMarking(row.original)"
            />
            <UButton
              v-if="canCorrect && row.original.status !== 'PENDING'"
              color="neutral"
              variant="outline"
              size="sm"
              label="Corregir"
              :aria-label="`Corregir la parada de ${row.original.location.customer.name}`"
              :disabled="busyId !== null"
              @click="startCorrecting(row.original)"
            />
            <UButton
              v-if="canReorder"
              color="neutral"
              variant="ghost"
              size="sm"
              icon="i-lucide-arrow-up"
              :aria-label="`Subir la parada de ${row.original.location.customer.name}`"
              :disabled="row.index === 0 || busyId !== null"
              @click="move(row.index, -1)"
            />
            <UButton
              v-if="canReorder"
              color="neutral"
              variant="ghost"
              size="sm"
              icon="i-lucide-arrow-down"
              :aria-label="`Bajar la parada de ${row.original.location.customer.name}`"
              :disabled="row.index === stops.length - 1 || busyId !== null"
              @click="move(row.index, 1)"
            />
            <!-- Una parada resuelta tiene venta y movimientos colgando: la
                 API no deja quitarla y acá ni se ofrece. -->
            <UButton
              v-if="editable && row.original.status === 'PENDING'"
              color="neutral"
              variant="ghost"
              size="sm"
              icon="i-lucide-trash-2"
              :aria-label="`Quitar la parada de ${row.original.location.customer.name}`"
              :disabled="busyId !== null"
              @click="removingId = row.original.id"
            />
          </div>
        </template>
      </UTable>
    </UPageBody>
  </SectionCard>
</template>
