<script setup lang="ts">
import {
  containerDifference,
  expectedFullReturn,
  formatCalendarDay,
  formatInstantInLima,
  formatSoles,
} from "@yacco/shared";
import type {
  ContainerType,
  CreateRouteSettlementResponse,
  Route,
  RouteSettlementDifferences,
  RouteSettlementView,
} from "@yacco/shared";

/**
 * La liquidación de la ruta (HU-17): la pantalla contra la que se cuentan los
 * envases en la puerta. Sirve ANTES de liquidar: muestra lo que dice el libro,
 * pide los dos únicos números que cuenta una persona (llenos que volvieron y
 * vacíos descargados) y calcula las diferencias.
 *
 * Una diferencia se muestra con su número y su razón, y **nunca** bloquea el
 * cierre. La nota libre está justamente para explicarla.
 */
const routeId = String(useRoute().params.id);
const api = useApi();

const route = ref<Route | null>(null);
const view = ref<RouteSettlementView | null>(null);
const catalog = ref<ContainerType[]>([]);
const loading = ref(true);
const loadError = ref<unknown>(null);
const slow = useSlowRequest(loading);

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    const [routeResponse, viewResponse, types] = await Promise.all([
      api.request<Route>(`/routes/${routeId}`),
      api.request<RouteSettlementView>(`/routes/${routeId}/settlement`),
      // El catálogo de su endpoint: arma la hoja de conteo de vacíos por tipo.
      api.request<ContainerType[]>("/container-types"),
    ]);
    route.value = routeResponse;
    view.value = viewResponse;
    catalog.value = types;
  } catch (error) {
    loadError.value = error;
  } finally {
    loading.value = false;
  }
}
onMounted(load);

useHead(() => ({
  title: route.value
    ? `Liquidación del ${formatCalendarDay(route.value.date)} · Yacco`
    : "Liquidación · Yacco",
}));

const notFound = computed(
  () => loadError.value instanceof ApiError && loadError.value.status === 404,
);
const settlement = computed(() => view.value?.settlement ?? null);
const canSettle = computed(() => route.value?.status === "FINISHED" && settlement.value === null);

// Lo que se escribe, en crudo.
const fullReturned = ref("");
const emptiesByType = reactive<Record<string, string>>({});
const notes = ref("");
const validationError = ref<string | null>(null);
const submitError = ref<string | null>(null);
const submitting = ref(false);
/** Sólo llegan en la respuesta del POST; al volver a entrar se recalculan lo que se puede. */
const differences = ref<RouteSettlementDifferences | null>(null);

watch([fullReturned, emptiesByType], () => {
  validationError.value = null;
});

const types = computed(() =>
  view.value ? countableTypes(catalog.value, view.value.expected) : [],
);
const counted = computed(() =>
  types.value.map((type) => ({
    type,
    quantity: emptiesCountOrNull(emptiesByType[type.id] ?? ""),
  })),
);

/**
 * El aviso agregado espera a que alguien escriba: un campo vacío vale cero,
 * pero abrir la pantalla con una diferencia en rojo gritaría antes de que nadie
 * cuente nada. La tabla sí la muestra por línea desde el arranque: ahí es una
 * columna, y es lo que hace visible que vacío es cero.
 */
const live = computed(() => {
  if (!view.value) return { kind: "none" } as const;
  const typed = types.value.some((type) => String(emptiesByType[type.id] ?? "").trim() !== "");
  const valid = counted.value.every((row) => row.quantity !== null);
  const total = counted.value.reduce((sum, row) => sum + (row.quantity ?? 0), 0);
  return liveDifference(
    view.value.expected,
    countOrNull(fullReturned.value),
    typed && valid ? total : null,
  );
});

async function settle(): Promise<void> {
  if (submitting.value) return;
  const returned = countOrNull(fullReturned.value);
  if (returned === null) {
    validationError.value = "Los llenos que volvieron deben ser un número entero, 0 o más";
    return;
  }
  const invalid = counted.value.find((row) => row.quantity === null);
  if (invalid) {
    validationError.value = `Los vacíos contados de ${invalid.type.name} deben ser un número entero, 0 o más`;
    return;
  }

  submitting.value = true;
  submitError.value = null;
  try {
    const response = await api.request<CreateRouteSettlementResponse>(
      `/routes/${routeId}/settlement`,
      {
        method: "POST",
        body: {
          fullReturned: returned,
          // Sólo las líneas con algo: contar cero de un tipo no es un movimiento.
          emptiesCollected: counted.value
            .filter((row) => (row.quantity ?? 0) > 0)
            .map((row) => ({ containerTypeId: row.type.id, quantity: row.quantity! })),
          ...(notes.value.trim() === "" ? {} : { notes: notes.value.trim() }),
        },
      },
    );
    differences.value = response.differences;
    await load();
  } catch (error) {
    // El 403 de Nest es genérico: se dice en el vocabulario de la planta. El
    // 409 (no terminada, ya liquidada) trae su propio mensaje.
    submitError.value =
      error instanceof ApiError && error.status === 403
        ? "Sólo un administrador puede liquidar la ruta."
        : describeApiFailure(error);
  } finally {
    submitting.value = false;
  }
}

const settledContainers = computed(() =>
  settlement.value ? (differences.value?.containers ?? containerDifference(settlement.value)) : 0,
);
const settledEmpties = computed(() =>
  settlement.value && view.value
    ? (differences.value?.empties ??
      view.value.expected.emptiesPickedUp - settlement.value.emptiesCollected)
    : 0,
);
</script>

<template>
  <AppPage
    :title="route ? `Liquidación de la ruta del ${formatCalendarDay(route.date)}` : 'Liquidación'"
    :description="route ? route.driver.name : 'Cargando…'"
  >
    <template #actions>
      <UButton
        :to="`/routes/${routeId}`"
        color="neutral"
        variant="ghost"
        icon="i-lucide-arrow-left"
        label="Volver a la ruta"
      />
    </template>

    <ResourceState
      :loading="loading"
      :slow="slow"
      :not-found="notFound"
      :error-message="loadError === null ? null : describeApiFailure(loadError)"
      noun="liquidación"
      article="la"
      not-found-title="Esa ruta no existe"
      back-to="/routes"
      back-label="Volver a rutas"
      @retry="load"
    >
      <div v-if="route && view" class="max-w-5xl space-y-6">
        <div class="flex flex-wrap items-center gap-3">
          <UBadge
            :color="ROUTE_STATUS[route.status].color"
            variant="subtle"
            size="lg"
            :label="ROUTE_STATUS[route.status].label"
          />
          <UAlert
            v-if="view.unresolvedStops > 0"
            role="status"
            color="warning"
            variant="subtle"
            class="flex-1"
            :title="
              view.unresolvedStops === 1
                ? 'Queda 1 parada sin resolver: lo que haya pasado ahí no está en estos números.'
                : `Quedan ${view.unresolvedStops} paradas sin resolver: lo que haya pasado ahí no está en estos números.`
            "
          />
          <UAlert
            v-if="route.status === 'IN_PROGRESS' || route.status === 'PLANNED'"
            role="status"
            color="info"
            variant="subtle"
            class="flex-1"
            :title="
              route.status === 'IN_PROGRESS'
                ? 'La ruta todavía está en curso. Se puede liquidar cuando esté terminada.'
                : 'La ruta todavía no salió. Se puede liquidar cuando esté terminada.'
            "
          />
        </div>

        <SectionCard
          title="Lo que dice el libro"
          description="Sale de lo ya registrado en la ruta; nadie lo escribe a mano."
        >
          <dl class="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatTile label="Llenos que salieron" :value="view.expected.fullOut" />
            <StatTile label="Entregados en canje" :value="view.expected.fullDelivered" />
            <StatTile
              label="Vendidos completos"
              :value="view.expected.fullSold"
              note="Esos envases salieron del parque."
            />
            <StatTile
              label="Deberían volver"
              :value="expectedFullReturn(view.expected)"
              note="Salieron menos entregados menos vendidos."
            />
            <StatTile label="Vacíos recogidos" :value="view.expected.emptiesPickedUp" />
          </dl>
          <!-- Liquidada, el dinero de referencia es el de la fila persistida (más
               abajo): repetirlo acá sólo invita a preguntar cuál vale. -->
          <template v-if="settlement === null">
            <h3 class="mt-6 mb-3 font-medium text-highlighted">Dinero</h3>
            <dl class="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <StatTile label="Total vendido" :value="formatSoles(view.expected.totalSold)" />
              <StatTile label="Cobrado" :value="formatSoles(view.expected.totalCollected)" />
              <StatTile
                label="En efectivo"
                :value="formatSoles(view.expected.totalCashCollected)"
                note="Es lo que el chofer trae en la mano."
              />
              <StatTile
                label="Por confirmar"
                :value="formatSoles(view.expected.totalPendingConfirmation)"
                note="Yape, Plin o transferencias sin verificar."
              />
              <StatTile label="Al fiado" :value="formatSoles(view.expected.totalOnCredit)" />
            </dl>
          </template>
        </SectionCard>

        <SectionCard
          v-if="settlement === null"
          title="Lo que se contó en la puerta"
          description="Lo único que se cuenta a mano. Todo lo demás sale del libro."
        >
          <form class="space-y-6" novalidate aria-label="Liquidar la ruta" @submit.prevent="settle">
            <div class="grid gap-5 sm:grid-cols-[14rem_1fr]">
              <UFormField
                label="Llenos que volvieron sin entregar"
                :help="`Según el libro deberían volver ${expectedFullReturn(view.expected)}.`"
              >
                <UInput
                  v-model="fullReturned"
                  type="number"
                  :min="0"
                  :step="1"
                  :disabled="submitting || !canSettle"
                  class="w-full"
                />
              </UFormField>
              <UFormField
                label="Nota (opcional)"
                help="Si hay una diferencia, acá se explica. La diferencia se registra igual."
              >
                <UInput
                  v-model="notes"
                  placeholder="Faltaron 2 bidones; el chofer dice que se rompió uno en la ruta"
                  :disabled="submitting || !canSettle"
                  class="w-full"
                />
              </UFormField>
            </div>

            <div class="space-y-2">
              <h3 class="font-medium text-highlighted">Vacíos contados al descargar</h3>
              <p class="text-sm text-muted">
                Uno por tipo de envase: cada línea vuelve al galpón como su propio movimiento. Un
                campo vacío cuenta como cero.
              </p>
              <table class="w-full text-sm">
                <caption class="sr-only">
                  Vacíos contados al descargar el camión, por tipo de envase
                </caption>
                <thead class="text-left text-xs tracking-wide text-muted uppercase">
                  <tr>
                    <th scope="col" class="py-2 font-medium">Tipo de envase</th>
                    <th scope="col" class="py-2 text-right font-medium">Según el libro</th>
                    <th scope="col" class="py-2 pl-6 font-medium">Contados</th>
                    <th scope="col" class="py-2 text-right font-medium">Diferencia</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-default">
                  <tr v-for="row in counted" :key="row.type.id">
                    <td class="py-2 font-medium text-highlighted">{{ row.type.name }}</td>
                    <td class="py-2 text-right tabular-nums">
                      {{ pickedUpOf(view.expected, row.type.id) }}
                    </td>
                    <td class="py-2 pl-6">
                      <UInput
                        v-model="emptiesByType[row.type.id]"
                        type="number"
                        :min="0"
                        :step="1"
                        :aria-label="`Vacíos contados de ${row.type.name}`"
                        :disabled="submitting || !canSettle"
                        class="w-28"
                      />
                    </td>
                    <td
                      class="py-2 text-right font-medium tabular-nums"
                      :class="
                        pickedUpOf(view.expected, row.type.id) - (row.quantity ?? 0) === 0
                          ? 'text-success'
                          : 'text-warning'
                      "
                    >
                      {{
                        pickedUpOf(view.expected, row.type.id) - (row.quantity ?? 0) === 0
                          ? "Cuadra"
                          : describeDifference(
                              pickedUpOf(view.expected, row.type.id) - (row.quantity ?? 0),
                            )
                      }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <UAlert
              v-if="live.kind === 'squares'"
              role="status"
              color="success"
              variant="subtle"
              icon="i-lucide-circle-check"
              title="Con estos números la ruta cuadra."
            />
            <UAlert
              v-else-if="live.kind === 'gap'"
              role="status"
              color="warning"
              variant="subtle"
              icon="i-lucide-triangle-alert"
              title="Con estos números va a quedar registrada una diferencia:"
            >
              <template #description>
                <ul class="list-disc pl-5">
                  <li v-if="live.full !== null">
                    Llenos: {{ formatDifference(live.full) }} ({{ describeGap(live.full) }} respecto
                    del libro).
                  </li>
                  <li v-if="live.empties !== null">
                    Vacíos: {{ formatDifference(live.empties) }} ({{ describeGap(live.empties) }}
                    respecto del libro).
                  </li>
                </ul>
                <p class="mt-1">
                  Se puede liquidar igual: la diferencia queda registrada, no bloquea el cierre.
                </p>
              </template>
            </UAlert>

            <UAlert
              v-if="validationError"
              role="alert"
              color="error"
              variant="subtle"
              :title="validationError"
            />
            <UAlert
              v-if="submitError"
              role="alert"
              color="error"
              variant="subtle"
              :title="submitError"
            />

            <div class="flex items-center justify-end gap-4 border-t border-default pt-5">
              <p v-if="!canSettle" class="text-sm text-muted">
                Sólo se liquida una ruta terminada.
              </p>
              <UButton
                type="submit"
                icon="i-lucide-scale"
                :disabled="submitting || !canSettle"
                :label="submitting ? 'Liquidando…' : 'Liquidar la ruta'"
              />
            </div>
          </form>
        </SectionCard>

        <SectionCard
          v-else
          title="Liquidada"
          :description="`Cerrada el ${formatInstantInLima(settlement.settledAt)}.`"
        >
          <div class="space-y-6">
            <!-- Dice lo que el dato mide y nada más: se corrigió una parada después
                 del cierre. No dice que la liquidación esté mal (corregir una ruta
                 liquidada está permitido a propósito). -->
            <UAlert
              v-if="view.settlementOutdated"
              role="status"
              color="warning"
              variant="subtle"
              icon="i-lucide-history"
              title="Se corrigió una parada después de cerrar esta liquidación."
            />

            <dl class="grid gap-3 sm:grid-cols-4">
              <StatTile label="Llenos que volvieron" :value="settlement.fullReturned" />
              <StatTile label="Vacíos contados" :value="settlement.emptiesCollected" />
              <StatTile
                label="Diferencia de llenos"
                :tone="settledContainers === 0 ? 'success' : 'warning'"
                :value="settledContainers === 0 ? 'Cuadró' : formatDifference(settledContainers)"
              />
              <!-- Esta celda compara contra `expected.emptiesPickedUp`, que la API
                   recalcula en vivo del libro y no se persiste en la liquidación:
                   no existe un valor "del cierre". Corregir una parada mueve ese
                   número, y entonces hay que decirlo acá. -->
              <StatTile
                label="Diferencia de vacíos"
                :tone="settledEmpties === 0 ? 'success' : 'warning'"
                :value="settledEmpties === 0 ? 'Cuadró' : formatDifference(settledEmpties)"
                :note="
                  view.settlementOutdated
                    ? 'Comparado contra el libro de hoy, que ya incluye la corrección.'
                    : undefined
                "
              />
            </dl>

            <div v-if="settlement.emptiesCollectedByType.length > 0">
              <h3 class="mb-2 font-medium text-highlighted">Vacíos descargados, por tipo</h3>
              <ul class="space-y-1 text-sm">
                <li v-for="line in settlement.emptiesCollectedByType" :key="line.containerTypeId">
                  {{ line.containerTypeName }}: {{ line.quantity }}
                  <span v-if="differences" class="text-warning">{{
                    typeDifferenceNote(differences, line.containerTypeId)
                  }}</span>
                </li>
              </ul>
            </div>

            <p v-if="settlement.notes" class="text-sm">
              <span class="font-medium text-highlighted">Nota:</span> {{ settlement.notes }}
            </p>

            <div>
              <h3 class="mb-3 font-medium text-highlighted">Dinero de la ruta</h3>
              <!-- La misma deriva tiene dos causas y sólo una se nombra con certeza:
                   sin corrección posterior, lo único que pudo mover el dinero es un
                   pago resuelto. Con corrección, atribuirlo a los pagos sería
                   nombrar la causa equivocada. -->
              <UAlert
                v-if="moneyDrifted(settlement, view.expected)"
                role="status"
                color="warning"
                variant="subtle"
                class="mb-3"
                :title="
                  view.settlementOutdated
                    ? `Estos son los montos del momento en que se liquidó. El libro hoy dice ${formatSoles(view.expected.totalCollected)} cobrado.`
                    : `Estos son los montos del momento en que se liquidó. Desde entonces se resolvió algún pago que estaba por confirmar, así que el libro hoy dice ${formatSoles(view.expected.totalCollected)} cobrado.`
                "
              />
              <dl class="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <StatTile label="Total vendido" :value="formatSoles(settlement.totalSold)" />
                <StatTile label="Cobrado" :value="formatSoles(settlement.totalCollected)" />
                <StatTile label="En efectivo" :value="formatSoles(settlement.totalCashCollected)" />
                <StatTile
                  label="Por confirmar"
                  :value="formatSoles(settlement.totalPendingConfirmation)"
                />
                <StatTile label="Al fiado" :value="formatSoles(settlement.totalOnCredit)" />
              </dl>
            </div>
          </div>
        </SectionCard>
      </div>
    </ResourceState>
  </AppPage>
</template>
