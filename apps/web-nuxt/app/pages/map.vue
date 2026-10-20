<script setup lang="ts">
import { formatInstantInLima } from "@yacco/shared";
import type {
  LiveRouteLocation,
  LiveRouteLocations,
  PlantLocation,
  Route,
  RouteLocationPoint,
  RoutePitStop,
  RouteStop,
} from "@yacco/shared";
import type { LiveMarker, StopMarker } from "~/utils/route-map";

/**
 * «Mapa» (Fase 3, fila 10, HU-27): desde la planta, dónde está cada vehículo
 * en reparto. El celular manda su ubicación cada 5 minutos, así que la
 * pantalla se refresca sola cada minuto: más seguido no mostraría nada nuevo.
 * Todo lo que el mapa dibuja también está escrito en la lista de al lado.
 */
useHead({ title: "Mapa · Yacco" });

interface SelectedRoute {
  route: Route;
  pits: RoutePitStop[];
  track: RouteLocationPoint[];
}

const api = useApi();
const live = ref<LiveRouteLocations | null>(null);
const plant = ref<PlantLocation | null>(null);
const loading = ref(true);
const loadError = ref<string | null>(null);
const now = ref(new Date());
const selectedRouteId = ref<string | null>(null);
const selected = ref<SelectedRoute | null>(null);
const selectedError = ref<string | null>(null);

async function loadSelected(routeId: string): Promise<void> {
  try {
    const [route, pits, track] = await Promise.all([
      api.request<Route>(`/routes/${routeId}`),
      api.request<RoutePitStop[]>(`/routes/${routeId}/pit-stops`),
      api.request<RouteLocationPoint[]>(`/routes/${routeId}/location-points`),
    ]);
    if (selectedRouteId.value !== routeId) return;
    selected.value = { route, pits, track };
    selectedError.value = null;
  } catch (error) {
    if (selectedRouteId.value === routeId) selectedError.value = describeApiFailure(error);
  }
}

async function load(): Promise<void> {
  loadError.value = null;
  try {
    const [latest, plantLocation] = await Promise.all([
      api.request<LiveRouteLocations>("/route-locations/latest"),
      plant.value === null
        ? api.request<PlantLocation>("/settings/plant-location")
        : Promise.resolve(plant.value),
    ]);
    live.value = latest;
    plant.value = plantLocation;
    now.value = new Date();
    // La ruta elegida que terminó ya no está en curso: deja de estar elegida.
    if (
      selectedRouteId.value !== null &&
      !latest.routes.some((row) => row.routeId === selectedRouteId.value)
    ) {
      selectedRouteId.value = null;
      selected.value = null;
    }
    if (selectedRouteId.value !== null) await loadSelected(selectedRouteId.value);
  } catch (error) {
    loadError.value = describeApiFailure(error);
  } finally {
    loading.value = false;
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  void load();
  timer = setInterval(() => void load(), MAP_REFRESH_MS);
});
onBeforeUnmount(() => {
  if (timer !== null) clearInterval(timer);
});

async function choose(routeId: string): Promise<void> {
  if (selectedRouteId.value === routeId) return;
  selectedRouteId.value = routeId;
  selected.value = null;
  selectedError.value = null;
  await loadSelected(routeId);
}

const rows = computed(() => live.value?.routes ?? []);

function routeLabel(row: LiveRouteLocation): string {
  return [row.driverName, row.vehiclePlate ?? "sin vehículo", row.zoneName ?? "sin zona"].join(
    " · ",
  );
}

function signalText(row: LiveRouteLocation): string {
  if (row.lastPoint === null) return "Sin señal · todavía no mandó su ubicación";
  const ago = minutesAgoText(row.lastPoint.recordedAt, now.value);
  return row.noSignal ? `Sin señal · último punto ${ago}` : ago;
}

const liveMarkers = computed<LiveMarker[]>(() =>
  rows.value.flatMap((row) => {
    const point =
      row.lastPoint === null ? null : mapPoint(row.lastPoint.latitude, row.lastPoint.longitude);
    return point === null
      ? []
      : [{ routeId: row.routeId, label: routeLabel(row), point, noSignal: row.noSignal }];
  }),
);

function stopsOf(route: Route): RouteStop[] {
  return [...route.stops].sort((a, b) => a.position - b.position);
}

const stopMarkers = computed<StopMarker[]>(() =>
  selected.value === null
    ? []
    : stopsOf(selected.value.route).flatMap((stop) => {
        const point = mapPoint(stop.location.latitude, stop.location.longitude);
        return point === null
          ? []
          : [
              {
                id: stop.id,
                label: `${stop.position}. ${stop.location.customer.name} · ${STOP_STATUS[stop.status].label}`,
                point,
                status: stop.status,
              },
            ];
      }),
);

const trackPoints = computed(() =>
  (selected.value?.track ?? []).flatMap((row) => {
    const point = mapPoint(row.latitude, row.longitude);
    return point === null ? [] : [point];
  }),
);

const plantPoint = computed(() =>
  plant.value === null ? null : mapPoint(plant.value.latitude, plant.value.longitude),
);

const hasPits = computed(() => (selected.value?.pits.length ?? 0) > 0);

const selectedRow = computed(
  () => rows.value.find((row) => row.routeId === selectedRouteId.value) ?? null,
);
</script>

<template>
  <AppPage
    title="Mapa"
    description="Dónde están los vehículos en reparto. Se actualiza solo cada minuto."
  >
    <UPageBody>
      <ListStatus
        v-if="loading || loadError || rows.length === 0"
        :error-message="loadError"
        :loading="loading"
        :empty="true"
        loading-label="Cargando el mapa…"
        error-title="No se pudo cargar el mapa"
        empty-icon="i-lucide-map-pinned"
        empty-title="No hay rutas en curso ahora."
        empty-description="Cuando un chofer sale a ruta, aparece acá."
        @retry="load"
      />

      <PlantMap
        :plant="plantPoint"
        :live="liveMarkers"
        :track="trackPoints"
        :stops="stopMarkers"
        :selected-route-id="selectedRouteId"
        @select="choose"
      />

      <UPageGrid v-if="rows.length > 0" as="section" aria-label="Rutas en curso">
        <UPageCard
          v-for="row in rows"
          :key="row.routeId"
          as="article"
          :variant="row.routeId === selectedRouteId ? 'subtle' : 'outline'"
          :aria-label="`Ruta de ${row.driverName}`"
          :title="routeLabel(row)"
        >
          <template #description>
            <div class="flex flex-wrap items-center gap-2">
              <UBadge
                v-if="row.noSignal"
                color="neutral"
                variant="subtle"
                icon="i-lucide-wifi-off"
                label="Sin señal"
              />
              <span>{{ signalText(row) }}</span>
            </div>
          </template>
          <UButton
            :label="`Ver recorrido de ${row.driverName}`"
            icon="i-lucide-route"
            color="neutral"
            variant="outline"
            :disabled="row.routeId === selectedRouteId"
            @click="choose(row.routeId)"
          />
        </UPageCard>
      </UPageGrid>

      <UPageBody
        v-if="selectedRow"
        as="section"
        :aria-label="`Recorrido de ${selectedRow.driverName}`"
      >
        <UPageCard variant="naked" :title="`Recorrido de ${selectedRow.driverName}`">
          <template #description>
            <span v-if="selected">
              {{ selected.track.length }}
              {{ selected.track.length === 1 ? "punto" : "puntos" }} de ubicación hoy
            </span>
          </template>
          <template #footer>
            <UButton
              :to="`/routes/${selectedRow.routeId}`"
              variant="link"
              icon="i-lucide-arrow-right"
              label="Abrir la ruta"
            />
          </template>
        </UPageCard>

        <UAlert
          v-if="selectedError"
          role="alert"
          color="error"
          variant="subtle"
          :title="selectedError"
        />

        <template v-if="selected">
          <UPageList as="ol" aria-label="Paradas">
            <li
              v-for="stop in stopsOf(selected.route)"
              :key="stop.id"
              class="flex flex-wrap items-center gap-2 py-1"
            >
              <span>{{ stop.position }}. {{ stop.location.customer.name }}</span>
              <UBadge
                :color="STOP_STATUS[stop.status].color"
                variant="subtle"
                :label="STOP_STATUS[stop.status].label"
              />
              <span v-if="mapPoint(stop.location.latitude, stop.location.longitude) === null">
                Sin coordenadas
              </span>
            </li>
          </UPageList>

          <UPageList v-if="hasPits" as="ul" aria-label="Paradas en planta">
            <li
              v-for="pit in selected.pits"
              :key="pit.id"
              class="flex flex-wrap items-center gap-2 py-1"
            >
              <span>Parada en planta · {{ formatInstantInLima(pit.createdAt) }}</span>
              <UBadge v-if="pit.voidedAt" color="neutral" variant="subtle" label="Anulada" />
            </li>
          </UPageList>
        </template>
      </UPageBody>
    </UPageBody>
  </AppPage>
</template>
