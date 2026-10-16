<script setup lang="ts">
import { formatCalendarDay, limaToday } from "@yacco/shared";
import type { Page, Route, RouteStop, RouteTruckStockLine } from "@yacco/shared";

/**
 * «Mi ruta»: el chofer en la calle, con el celular (HU-11 a HU-14, en línea).
 * Ve SOLO sus rutas de hoy —la API filtra GET /routes por el chofer que
 * pregunta— y registra cada parada con el mismo formulario y el mismo PATCH
 * que usa la oficina, sin poder cambiar precios (supuesto 12). Sin conexión,
 * sincronización y fotos quedan para después del piloto.
 */
useHead({ title: "Mi ruta · Yacco" });

const api = useApi();
const session = useSession();
const today = limaToday();

const routes = ref<Route[]>([]);
const truckStock = ref<Record<string, RouteTruckStockLine[]>>({});
const loading = ref(true);
const loadError = ref<string | null>(null);
const actionError = ref<string | null>(null);
const busyRouteId = ref<string | null>(null);
/** La parada con el formulario abierto; una a la vez, como en la oficina. */
const markingStopId = ref<string | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    // Con `driverId`, también para quien no es solo chofer: a un administrador
    // la API le devuelve las rutas de todos, y «Mi ruta» son las suyas.
    const page = await api.request<Page<Route>>("/routes", {
      query: { date: today, driverId: session.user.value?.id },
    });
    const stocks = await Promise.all(
      page.data.map((route) =>
        api
          .request<RouteTruckStockLine[]>(`/routes/${route.id}/truck-stock`)
          // Lo que queda arriba ayuda, pero no es la pantalla: si no se puede
          // leer, no se muestra ningún número.
          .catch(() => [] as RouteTruckStockLine[]),
      ),
    );
    truckStock.value = Object.fromEntries(page.data.map((route, i) => [route.id, stocks[i]!]));
    // Juntas: la ruta no aparece sin lo que le queda arriba y después «salta».
    routes.value = page.data;
  } catch (error) {
    loadError.value = describeApiFailure(error);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

function stopsOf(route: Route): RouteStop[] {
  return [...route.stops].sort((a, b) => a.position - b.position);
}

function pendingCount(route: Route): number {
  return route.stops.filter((stop) => stop.status === "PENDING").length;
}

async function changeStatus(route: Route, action: "start" | "finish"): Promise<void> {
  if (busyRouteId.value !== null) return;
  busyRouteId.value = route.id;
  actionError.value = null;
  try {
    await api.request<Route>(`/routes/${route.id}/${action}`, { method: "PATCH" });
    await load();
  } catch (error) {
    actionError.value = describeApiFailure(error);
  } finally {
    busyRouteId.value = null;
  }
}

async function marked(): Promise<void> {
  markingStopId.value = null;
  await load();
}
</script>

<template>
  <AppPage title="Mi ruta" :description="formatCalendarDay(today)">
    <!-- Mi ruta se usa en el celular: en escritorio conserva el ancho de columna. -->
    <UPageList class="mx-auto w-full max-w-xl">
      <ListStatus
        v-if="loading || loadError || routes.length === 0"
        :error-message="loadError"
        :loading="loading"
        :empty="true"
        loading-label="Cargando tu ruta…"
        error-title="No se pudo cargar tu ruta"
        empty-icon="i-lucide-truck"
        empty-title="Hoy no tienes rutas asignadas."
        empty-description="Si esperabas una, avisa a la oficina."
        @retry="load"
      />

      <UAlert v-if="actionError" role="alert" color="error" variant="subtle" :title="actionError" />

      <UPageList
        v-for="route in routes"
        :key="route.id"
        as="section"
        :aria-label="`Ruta ${route.zone?.name ?? 'sin zona'}`"
      >
        <UPageCard
          variant="naked"
          :description="`${route.stops.length} ${route.stops.length === 1 ? 'parada' : 'paradas'}`"
        >
          <template #title>
            <div class="flex flex-wrap items-center gap-2">
              <h2>{{ route.zone ? `Zona ${route.zone.name}` : "Ruta sin zona" }}</h2>
              <UBadge
                :color="ROUTE_STATUS[route.status].color"
                variant="subtle"
                size="lg"
                :label="ROUTE_STATUS[route.status].label"
              />
            </div>
          </template>
        </UPageCard>

        <div
          v-if="(truckStock[route.id] ?? []).length > 0"
          role="group"
          class="flex flex-wrap items-center gap-2"
          aria-label="Queda arriba del camión"
        >
          <span>Queda arriba:</span>
          <UBadge
            v-for="line in truckStock[route.id]"
            :key="line.containerType.id"
            color="primary"
            variant="subtle"
            :label="`${line.onBoard} × ${line.containerType.name}`"
          />
        </div>

        <UButton
          v-if="route.status === 'PLANNED'"
          block
          size="xl"
          icon="i-lucide-truck"
          :loading="busyRouteId === route.id"
          :disabled="busyRouteId !== null"
          label="Salir a ruta"
          @click="changeStatus(route, 'start')"
        />

        <UPageCard
          v-for="stop in stopsOf(route)"
          :key="stop.id"
          as="article"
          variant="outline"
          :aria-label="`Parada ${stop.position}: ${stop.location.customer.name}`"
        >
          <template #header>
            <div class="flex flex-wrap items-center gap-2">
              <span>Parada {{ stop.position }} · {{ STOP_ORIGIN[stop.origin] }}</span>
              <UBadge
                :color="STOP_STATUS[stop.status].color"
                variant="subtle"
                :label="STOP_STATUS[stop.status].label"
              />
            </div>
          </template>
          <template #title>
            <h3>{{ stop.location.customer.name }}</h3>
          </template>
          <template #description>
            <p><LinkedText :text="stop.location.address" /></p>
            <p><LinkedText :text="stop.location.addressReference" /></p>
            <p v-if="stop.location.contactName">Recibe: {{ stop.location.contactName }}</p>
            <p v-if="stop.failureReason">Motivo: {{ stop.failureReason }}</p>
          </template>

          <div class="flex flex-wrap items-center gap-2">
            <UButton
              :to="`tel:${stop.location.phone}`"
              color="neutral"
              variant="outline"
              icon="i-lucide-phone"
              :label="`Llamar al ${stop.location.phone}`"
            />
            <UButton
              v-if="stop.location.latitude !== null && stop.location.longitude !== null"
              :to="googleMapsDirectionsUrl(stop.location.latitude, stop.location.longitude)"
              target="_blank"
              rel="noopener noreferrer"
              external
              color="neutral"
              variant="outline"
              icon="i-lucide-navigation"
              label="Cómo llegar"
            />
            <UButton
              v-if="
                route.status === 'IN_PROGRESS' &&
                stop.status === 'PENDING' &&
                markingStopId !== stop.id
              "
              icon="i-lucide-clipboard-check"
              :aria-label="`Registrar la parada ${stop.position}`"
              label="Registrar"
              block
              @click="markingStopId = stop.id"
            />
          </div>

          <RouteStopMarkForm
            v-if="markingStopId === stop.id"
            :route-id="route.id"
            :stop="stop"
            :can-change-price="false"
            capture-location
            @cancel="markingStopId = null"
            @marked="marked"
          />
        </UPageCard>

        <UButton
          v-if="route.status === 'IN_PROGRESS'"
          block
          size="xl"
          color="neutral"
          variant="outline"
          icon="i-lucide-flag"
          :loading="busyRouteId === route.id"
          :disabled="busyRouteId !== null || pendingCount(route) > 0"
          :label="
            pendingCount(route) > 0
              ? `Terminar ruta (faltan ${pendingCount(route)})`
              : 'Terminar ruta'
          "
          @click="changeStatus(route, 'finish')"
        />
      </UPageList>
    </UPageList>
  </AppPage>
</template>
