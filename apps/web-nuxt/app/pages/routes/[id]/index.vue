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

    <div class="space-y-6">
      <UAlert v-if="actionError" role="alert" color="error" variant="subtle" :title="actionError" />

      <RouteMarkOutcome
        v-if="markOutcome"
        :stop-name="markOutcome.stopName"
        :result="markOutcome.result"
      />

      <div
        v-if="confirmingFinish"
        role="group"
        aria-label="Confirmar el fin de la ruta"
        class="rounded-lg border border-default bg-default p-5"
      >
        <template v-if="pendingStops === 0">
          <p class="text-highlighted">
            Todas las paradas están resueltas. Al terminar la ruta ya no se pueden marcar paradas ni
            cambiar su orden.
          </p>
          <div class="mt-4 flex gap-2">
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
          </div>
        </template>
        <template v-else>
          <p class="text-highlighted">
            {{
              pendingStops === 1
                ? "Todavía no se puede terminar la ruta: queda 1 parada sin resolver."
                : `Todavía no se puede terminar la ruta: quedan ${pendingStops} paradas sin resolver.`
            }}
            Cada parada tiene que quedar marcada como entregada o no entregada, o quitarse de la
            ruta.
          </p>
          <UButton class="mt-4" label="Entendido" @click="confirmingFinish = false" />
        </template>
      </div>

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
          <dl
            class="grid gap-5 rounded-lg border border-default bg-default p-5 text-sm sm:grid-cols-4"
          >
            <div>
              <dt class="text-muted">Chofer</dt>
              <dd class="font-medium text-highlighted">{{ route.driver.name }}</dd>
            </div>
            <div>
              <dt class="text-muted">Estado</dt>
              <dd>
                <UBadge
                  :color="ROUTE_STATUS[route.status].color"
                  variant="subtle"
                  :label="ROUTE_STATUS[route.status].label"
                />
              </dd>
            </div>
            <div>
              <dt class="text-muted">Zona</dt>
              <dd>
                <UBadge v-if="route.zone" color="neutral" variant="soft" :label="route.zone.name" />
                <span v-else class="text-dimmed">Sin zona</span>
              </dd>
            </div>
            <!-- "Creada" y no "Planificada": el estado de al lado ya se llama así. -->
            <div>
              <dt class="text-muted">Creada</dt>
              <dd class="text-highlighted tabular-nums">
                {{ formatInstantInLima(route.createdAt) }}
              </dd>
            </div>
          </dl>

          <RouteStopsSection
            :route="route"
            @changed="resource.reload"
            @marked="(outcome) => (markOutcome = outcome)"
          />
          <RouteLoadsSection :route="route" />
        </template>
      </ResourceState>
    </div>
  </AppPage>
</template>
