<script setup lang="ts">
import { formatCalendarDay, formatInstantInLima } from "@yacco/shared";
import type { Route, RouteStop } from "@yacco/shared";

/**
 * La hoja de ruta: el día, el chofer y las paradas en el orden en que se
 * visitan, con lo que hace falta para armarla y los dos botones que mueven la
 * ruta: iniciar y terminar.
 *
 * Toda acción recarga la ruta desde GET /routes/:id en vez de recomponer el
 * estado a mano: las posiciones las asigna el servidor, y una parada que otro
 * resolvió mientras tanto tiene que aparecer.
 */
const routeId = String(useRoute().params.id);
const api = useApi();
const resource = useApiResource<Route>(`/routes/${routeId}`);
const route = resource.data;

useHead(() => ({
  title: route.value ? `Ruta del ${formatCalendarDay(route.value.date)} · Yacco` : "Ruta · Yacco",
}));

const acting = ref(false);
const actionError = ref<string | null>(null);
const confirmingFinish = ref(false);
/** Vive acá y no en la sección: al recargar la ruta la sección se desmonta y el aviso se perdería. */
const markOutcome = ref<{ stopName: string; result: RouteStop } | null>(null);

const pendingStops = computed(
  () => route.value?.stops.filter((stop) => stop.status === "PENDING").length ?? 0,
);

async function transition(action: "start" | "finish"): Promise<void> {
  if (acting.value) return;
  acting.value = true;
  actionError.value = null;
  try {
    route.value = await api.request<Route>(`/routes/${routeId}/${action}`, { method: "PATCH" });
    confirmingFinish.value = false;
  } catch (error) {
    // 409: alguien la inició o la terminó entre la carga y el clic. Se recarga
    // para mostrar lo que de verdad pasó.
    actionError.value = describeApiFailure(error);
    confirmingFinish.value = false;
    await resource.reload();
  } finally {
    acting.value = false;
  }
}
</script>

<template>
  <AppPage
    :title="route ? `Ruta del ${formatCalendarDay(route.date)}` : 'Ruta'"
    :description="route ? route.driver.name : 'Cargando…'"
  >
    <template #actions>
      <UButton
        to="/routes"
        color="neutral"
        variant="ghost"
        icon="i-lucide-arrow-left"
        label="Volver a rutas"
      />
      <UButton
        v-if="route?.status === 'PLANNED'"
        icon="i-lucide-play"
        :disabled="acting"
        :label="acting ? 'Iniciando…' : 'Iniciar ruta'"
        @click="transition('start')"
      />
      <!-- Visible aunque queden paradas: es el diálogo el que explica por qué
           todavía no se puede. Un botón deshabilitado sin explicación no enseña
           nada; lo que no se hace es ofrecer confirmar algo que la API rechaza. -->
      <UButton
        v-if="route?.status === 'IN_PROGRESS' && !confirmingFinish"
        icon="i-lucide-flag"
        label="Terminar ruta"
        :disabled="acting"
        @click="confirmingFinish = true"
      />
      <!-- La liquidación se ofrece desde que la ruta terminó y sigue a mano una
           vez cerrada: es el registro de cómo cuadró. -->
      <UButton
        v-if="route?.status === 'FINISHED' || route?.status === 'SETTLED'"
        :to="`/routes/${routeId}/settlement`"
        icon="i-lucide-scale"
        :label="route.status === 'FINISHED' ? 'Liquidar la ruta' : 'Ver la liquidación'"
      />
    </template>

    <UAlert v-if="actionError" role="alert" color="error" variant="subtle" :title="actionError" />

    <RouteMarkOutcome
      v-if="markOutcome"
      :stop-name="markOutcome.stopName"
      :result="markOutcome.result"
    />

    <UAlert
      v-if="confirmingFinish && pendingStops === 0"
      role="group"
      aria-label="Confirmar el fin de la ruta"
      color="neutral"
      variant="outline"
      title="Todas las paradas están resueltas. Al terminar la ruta ya no se pueden marcar paradas ni cambiar su orden."
    >
      <template #actions>
        <UFieldGroup>
          <UButton
            color="neutral"
            variant="outline"
            label="No, todavía no"
            :disabled="acting"
            @click="confirmingFinish = false"
          />
          <UButton
            :disabled="acting"
            :label="acting ? 'Terminando…' : 'Sí, terminar la ruta'"
            @click="transition('finish')"
          />
        </UFieldGroup>
      </template>
    </UAlert>
    <UAlert
      v-else-if="confirmingFinish"
      role="group"
      aria-label="Confirmar el fin de la ruta"
      color="neutral"
      variant="outline"
      :title="
        pendingStops === 1
          ? 'Todavía no se puede terminar la ruta: queda 1 parada sin resolver.'
          : `Todavía no se puede terminar la ruta: quedan ${pendingStops} paradas sin resolver.`
      "
      description="Cada parada tiene que quedar marcada como entregada o no entregada, o quitarse de la ruta."
    >
      <template #actions>
        <UButton label="Entendido" @click="confirmingFinish = false" />
      </template>
    </UAlert>

    <ResourceState
      :loading="resource.loading.value"
      :slow="resource.slow.value"
      :not-found="resource.notFound.value"
      :error-message="resource.errorMessage.value"
      noun="ruta"
      article="la"
      back-to="/routes"
      back-label="Volver a rutas"
      @retry="resource.reload"
    >
      <template v-if="route">
        <UPageGrid>
          <UPageCard title="Chofer" :description="route.driver.name" variant="soft" />
          <UPageCard
            title="Vehículo"
            :description="route.vehicle ? route.vehicle.plate : 'Sin vehículo'"
            variant="soft"
          />
          <UPageCard title="Estado" variant="soft">
            <UFieldGroup>
              <UBadge
                :color="ROUTE_STATUS[route.status].color"
                variant="subtle"
                :label="ROUTE_STATUS[route.status].label"
              />
            </UFieldGroup>
          </UPageCard>
          <UPageCard v-if="route.zone" title="Zona" variant="soft">
            <UFieldGroup>
              <UBadge color="neutral" variant="soft" :label="route.zone.name" />
            </UFieldGroup>
          </UPageCard>
          <UPageCard v-else title="Zona" description="Sin zona" variant="soft" />
          <!-- "Creada" y no "Planificada": el estado de al lado ya se llama así. -->
          <UPageCard
            title="Creada"
            :description="formatInstantInLima(route.createdAt)"
            variant="soft"
          />
        </UPageGrid>

        <RouteVehiclesSection :route="route" @changed="resource.reload" />
        <RouteStopsSection
          :route="route"
          @changed="resource.reload"
          @marked="(outcome) => (markOutcome = outcome)"
        />
        <RouteLoadsSection :route="route" />
        <RoutePitStopsSection
          v-if="route.status !== 'PLANNED'"
          :route="route"
          @changed="resource.reload"
        />
      </template>
    </ResourceState>
  </AppPage>
</template>
