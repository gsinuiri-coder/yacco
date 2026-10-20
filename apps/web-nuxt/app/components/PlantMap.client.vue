<script setup lang="ts">
import "leaflet/dist/leaflet.css";
import type { CircleMarker, LayerGroup, Map as LeafletMap } from "leaflet";
import type { LiveMarker, MapPoint, StopMarker } from "~/utils/route-map";

/**
 * The map itself (Leaflet + OpenStreetMap tiles, free, with the attribution
 * OpenStreetMap asks for). Client only: Leaflet needs `window`. Everything it
 * shows is also listed as text next to it, so the screen reads without it.
 */
const props = defineProps<{
  plant: MapPoint | null;
  live: LiveMarker[];
  track: MapPoint[];
  stops: StopMarker[];
  selectedRouteId: string | null;
}>();
const emit = defineEmits<{ select: [routeId: string] }>();

const container = ref<HTMLElement | null>(null);
let map: LeafletMap | null = null;
let layers: LayerGroup | null = null;
let leaflet: typeof import("leaflet") | null = null;
let framed = false;

function circle(point: MapPoint, color: string, radius: number, dashed = false): CircleMarker {
  return leaflet!.circleMarker([point.latitude, point.longitude], {
    radius,
    color,
    fillColor: color,
    fillOpacity: dashed ? 0.2 : 0.8,
    weight: 2,
    dashArray: dashed ? "4 4" : undefined,
  });
}

function draw(): void {
  if (map === null || layers === null || leaflet === null) return;
  layers.clearLayers();
  const bounds: Array<[number, number]> = [];
  const keep = (point: MapPoint) => bounds.push([point.latitude, point.longitude]);

  if (props.plant !== null) {
    circle(props.plant, PLANT_MARKER_COLOR, 10).bindTooltip("Planta").addTo(layers);
    keep(props.plant);
  }
  if (props.track.length > 1) {
    leaflet
      .polyline(
        props.track.map((point) => [point.latitude, point.longitude]),
        { color: LIVE_MARKER_COLOR, weight: 3, opacity: 0.7 },
      )
      .addTo(layers);
  }
  for (const stop of props.stops) {
    circle(stop.point, STOP_MARKER_COLOR[stop.status], 7).bindTooltip(stop.label).addTo(layers);
    keep(stop.point);
  }
  for (const marker of props.live) {
    const selected = marker.routeId === props.selectedRouteId;
    circle(
      marker.point,
      marker.noSignal ? NO_SIGNAL_MARKER_COLOR : LIVE_MARKER_COLOR,
      selected ? 12 : 9,
      marker.noSignal,
    )
      .bindTooltip(marker.label, { permanent: selected })
      .on("click", () => emit("select", marker.routeId))
      .addTo(layers);
    keep(marker.point);
  }

  // Frame what there is once, and again when a route is chosen; a refresh
  // every minute must not pull the view away from where the office looks.
  if (!framed && bounds.length > 0) {
    map.fitBounds(bounds, { padding: [32, 32], maxZoom: 15 });
    framed = true;
  }
}

onMounted(async () => {
  leaflet = await import("leaflet");
  if (container.value === null) return;
  map = leaflet.map(container.value, { zoomControl: true });
  leaflet
    .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    })
    .addTo(map);
  // Lima, until there is something to frame.
  map.setView([-12.046374, -77.042793], 12);
  layers = leaflet.layerGroup().addTo(map);
  draw();
});

watch(
  () => props.selectedRouteId,
  () => {
    framed = false;
  },
);
watch(() => [props.plant, props.live, props.track, props.stops, props.selectedRouteId], draw, {
  deep: true,
});

onBeforeUnmount(() => {
  map?.remove();
  map = null;
});
</script>

<template>
  <div ref="container" role="region" aria-label="Mapa" class="h-[28rem] w-full rounded-md" />
</template>
