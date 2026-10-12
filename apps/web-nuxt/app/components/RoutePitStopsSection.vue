<script setup lang="ts">
import { formatInstantInLima, formatSoles, subtractAmounts } from "@yacco/shared";
import type { Route, RoutePitStopResponse } from "@yacco/shared";

const props = defineProps<{ route: Route }>();
const emit = defineEmits<{ changed: [] }>();

const api = useApi();
const session = useSession();

const pits = ref<RoutePitStopResponse[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);

const creating = ref(false);

const voidingPitId = ref<string | null>(null);
const voidReason = ref("");
const voidingSubmitting = ref(false);
const voidError = ref<string | null>(null);

const canAddPit = computed(
  () =>
    props.route.status === "IN_PROGRESS" && (session.hasRole("ADMIN") || session.hasRole("SELLER")),
);

const canVoid = computed(() => session.hasRole("ADMIN") && props.route.status !== "SETTLED");

async function loadPits(): Promise<void> {
  if (props.route.status === "PLANNED") {
    pits.value = [];
    loading.value = false;
    loadError.value = null;
    return;
  }
  loading.value = true;
  loadError.value = null;
  try {
    pits.value = await api.request<RoutePitStopResponse[]>(`/routes/${props.route.id}/pit-stops`);
  } catch (error) {
    loadError.value = describeApiFailure(error);
  } finally {
    loading.value = false;
  }
}

onMounted(loadPits);

watch(() => props.route.id, loadPits);

// El último pit no anulado
const latestNonVoidedPit = computed(() => {
  const nonVoided = pits.value.filter((p: RoutePitStopResponse) => p.voidedAt === null);
  if (nonVoided.length === 0) return null;
  // pits vienen ordenados por createdAt asc de la API
  return nonVoided[nonVoided.length - 1] ?? null;
});

function onPitCreated(): void {
  creating.value = false;
  loadPits();
  emit("changed");
}

function startVoiding(pit: RoutePitStopResponse): void {
  voidingPitId.value = pit.id;
  voidReason.value = "";
  voidError.value = null;
}

function cancelVoiding(): void {
  voidingPitId.value = null;
  voidReason.value = "";
  voidError.value = null;
}

async function confirmVoid(pitId: string): Promise<void> {
  if (voidingSubmitting.value) return;
  if (!voidReason.value.trim()) {
    voidError.value = "El motivo de la anulación es obligatorio.";
    return;
  }

  voidingSubmitting.value = true;
  voidError.value = null;
  try {
    await api.request<RoutePitStopResponse>(`/routes/${props.route.id}/pit-stops/${pitId}/void`, {
      method: "PATCH",
      body: { voidReason: voidReason.value.trim() },
    });
    cancelVoiding();
    await loadPits();
    emit("changed");
  } catch (error) {
    voidError.value = describeApiFailure(error);
  } finally {
    voidingSubmitting.value = false;
  }
}
</script>

<template>
  <SectionCard
    title="Paradas en planta"
    description="Paradas del camión en la planta durante el recorrido: cuadre de envases, sube, baja y entrega de efectivo."
  >
    <template #actions>
      <UButton
        v-if="canAddPit && !creating"
        icon="i-lucide-warehouse"
        label="Parada en planta"
        @click="creating = true"
      />
    </template>

    <div class="space-y-6">
      <div v-if="creating" class="rounded-lg border border-primary/40 bg-elevated p-4">
        <RoutePitStopForm :route="route" @cancel="creating = false" @created="onPitCreated" />
      </div>

      <div v-if="loading && !creating" class="py-6 text-center text-sm text-muted">
        Cargando paradas en planta…
      </div>

      <UAlert
        v-else-if="loadError"
        role="alert"
        color="error"
        variant="subtle"
        :title="loadError"
      />

      <ListStatus
        v-else-if="pits.length === 0 && !creating"
        :error-message="null"
        :loading="false"
        :empty="true"
        loading-label=""
        empty-icon="i-lucide-warehouse"
        empty-title="No hay paradas en planta registradas"
        empty-description="Durante el recorrido, el vehículo puede volver a la planta para cuadrar envases, descargar, recargar producto o entregar efectivo."
      />

      <div v-else class="space-y-4">
        <article
          v-for="pit in pits"
          :key="pit.id"
          class="space-y-3 rounded-lg border border-default bg-elevated/30 p-4"
        >
          <!-- Encabezado de la parada -->
          <header
            class="flex flex-wrap items-center justify-between gap-3 border-b border-default pb-3"
          >
            <div class="space-y-0.5">
              <div class="flex items-center gap-2">
                <h3 class="font-semibold text-highlighted">
                  Parada del {{ formatInstantInLima(pit.createdAt) }}
                </h3>
                <UBadge v-if="pit.voidedAt" color="error" variant="subtle" label="Anulado" />
              </div>
              <p class="text-xs text-muted">Registrada por {{ pit.recordedBy.name }}</p>
            </div>

            <div v-if="canVoid && pit.voidedAt === null && pit.id === latestNonVoidedPit?.id">
              <UButton
                v-if="voidingPitId !== pit.id"
                color="neutral"
                variant="outline"
                size="sm"
                icon="i-lucide-undo-2"
                label="Anular parada"
                @click="startVoiding(pit)"
              />
            </div>
          </header>

          <!-- Formulario de confirmación de anulación -->
          <div
            v-if="voidingPitId === pit.id"
            role="group"
            aria-label="Confirmar anulación"
            class="space-y-3 rounded-md border border-warning/40 bg-warning/5 p-4"
          >
            <div>
              <h4 class="font-semibold text-highlighted">Anular esta parada en planta</h4>
              <p class="text-xs text-muted">
                La parada quedará marcada como anulada. Se revertirán sus movimientos de carga y
                descarga, y su efectivo dejará de sumarse.
              </p>
            </div>
            <UFormField label="Motivo de la anulación" required>
              <UInput
                v-model="voidReason"
                placeholder="Escribe el motivo de la anulación"
                :disabled="voidingSubmitting"
                class="w-full"
              />
            </UFormField>
            <UAlert
              v-if="voidError"
              role="alert"
              color="error"
              variant="subtle"
              :title="voidError"
            />
            <div class="flex justify-end gap-2">
              <UButton
                color="neutral"
                variant="outline"
                size="sm"
                label="Cancelar"
                :disabled="voidingSubmitting"
                @click="cancelVoiding"
              />
              <UButton
                color="error"
                size="sm"
                label="Confirmar anulación"
                :disabled="voidingSubmitting"
                @click="confirmVoid(pit.id)"
              />
            </div>
          </div>

          <!-- Si está anulada: detalles de la anulación -->
          <div
            v-if="pit.voidedAt"
            class="rounded-md border border-error/30 bg-error/5 p-3 text-xs text-error"
          >
            <p class="font-medium">
              Anulada por {{ pit.voidedBy?.name }} el {{ formatInstantInLima(pit.voidedAt) }}
            </p>
            <p v-if="pit.voidReason" class="mt-0.5 text-muted">Motivo: {{ pit.voidReason }}</p>
          </div>

          <p v-if="pit.notes" class="text-sm text-highlighted">
            <span class="font-medium">Nota:</span> {{ pit.notes }}
          </p>

          <!-- Detalles de la parada en planta -->
          <div v-if="pit.vehicleId" class="rounded-md bg-primary/5 border border-primary/20 p-2.5 text-xs flex flex-wrap items-center gap-2">
            <span class="font-semibold text-primary">Cambio de vehículo en esta parada</span>
            <span v-if="pit.vehicleReason" class="text-muted">— Motivo: {{ pit.vehicleReason }}</span>
            <span v-if="pit.voidedAt" class="text-error font-medium">(Revertido al anular la parada)</span>
          </div>

          <div class="grid gap-4 text-xs sm:grid-cols-2 lg:grid-cols-4">
            <!-- Cuadre -->
            <div class="rounded-md bg-default p-3 space-y-1.5">
              <h4 class="font-semibold text-highlighted">Cuadre de envases</h4>
              <ul class="space-y-1">
                <li v-for="c in pit.counts" :key="c.id" class="text-muted">
                  <span class="font-medium text-highlighted">{{ c.containerType.name }}:</span>
                  {{ c.countedFull }} ll (esp. {{ c.expectedFull }}), {{ c.countedEmpty }} vac (esp.
                  {{ c.expectedEmpty }})
                  <p v-if="c.differenceReason" class="mt-0.5 text-warning italic">
                    Motivo: {{ c.differenceReason }}
                  </p>
                </li>
              </ul>
            </div>

            <!-- Baja -->
            <div class="rounded-md bg-default p-3 space-y-1.5">
              <h4 class="font-semibold text-highlighted">Baja (descarga)</h4>
              <div v-if="!pit.unloads || pit.unloads.length === 0" class="text-dimmed">
                No hubo descarga
              </div>
              <ul v-else class="space-y-1 text-muted">
                <li v-for="(u, uIndex) in pit.unloads" :key="uIndex">
                  {{ u.type === "EMPTY_UNLOAD" ? "Vacíos descargados" : "Llenos vueltos" }}:
                  {{ u.quantity }} de {{ u.containerType.name }}
                </li>
              </ul>
            </div>

            <!-- Sube -->
            <div class="rounded-md bg-default p-3 space-y-1.5">
              <h4 class="font-semibold text-highlighted">Sube (carga)</h4>
              <div v-if="!pit.loads || pit.loads.length === 0" class="text-dimmed">
                No hubo carga
              </div>
              <ul v-else class="space-y-1 text-muted">
                <li v-for="l in pit.loads" :key="l.id">
                  {{ l.quantity }} de {{ l.batchItem.containerType.name }} (Lote
                  {{ l.batchItem.batch.code }})
                </li>
              </ul>
            </div>

            <!-- Efectivo -->
            <div class="rounded-md bg-default p-3 space-y-1.5">
              <h4 class="font-semibold text-highlighted">Efectivo</h4>
              <div v-if="pit.cashDelivered === null" class="text-dimmed">No entregó efectivo</div>
              <div v-else class="space-y-1 text-muted">
                <p>
                  Entregado:
                  <span class="font-semibold text-highlighted">{{
                    formatSoles(pit.cashDelivered)
                  }}</span>
                </p>
                <p v-if="pit.cashExpected !== null">
                  Esperado: {{ formatSoles(pit.cashExpected) }} · Conserva:
                  {{ formatSoles(subtractAmounts(pit.cashExpected, pit.cashDelivered)) }}
                </p>
                <p v-if="pit.cashReason" class="text-warning italic">
                  Motivo: {{ pit.cashReason }}
                </p>
              </div>
            </div>
          </div>
        </article>
      </div>
    </div>
  </SectionCard>
</template>
