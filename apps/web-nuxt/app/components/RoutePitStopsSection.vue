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

    <UPageList>
      <UPageCard v-if="creating" variant="subtle">
        <RoutePitStopForm :route="route" @cancel="creating = false" @created="onPitCreated" />
      </UPageCard>

      <UAlert
        v-if="loading && !creating"
        role="status"
        color="neutral"
        variant="subtle"
        title="Cargando paradas en planta…"
      />

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

      <template v-else>
        <UPageCard
          v-for="pit in pits"
          :key="pit.id"
          as="article"
          variant="outline"
          :description="`Registrada por ${pit.recordedBy.name}`"
        >
          <template #title>
            <div class="flex flex-wrap items-center gap-2">
              <h3>Parada del {{ formatInstantInLima(pit.createdAt) }}</h3>
              <UBadge v-if="pit.voidedAt" color="error" variant="subtle" label="Anulado" />
            </div>
          </template>
          <template
            v-if="
              canVoid &&
              pit.voidedAt === null &&
              pit.id === latestNonVoidedPit?.id &&
              voidingPitId !== pit.id
            "
            #footer
          >
            <UButton
              color="neutral"
              variant="outline"
              size="sm"
              icon="i-lucide-undo-2"
              label="Anular parada"
              @click="startVoiding(pit)"
            />
          </template>

          <!-- Confirmación de la anulación -->
          <UPageCard
            v-if="voidingPitId === pit.id"
            role="group"
            aria-label="Confirmar anulación"
            variant="subtle"
            description="La parada quedará marcada como anulada. Se revertirán sus movimientos de carga y descarga, y su efectivo dejará de sumarse."
          >
            <template #title><h4>Anular esta parada en planta</h4></template>
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
          </UPageCard>

          <!-- Si está anulada: quién, cuándo y por qué -->
          <UAlert
            v-if="pit.voidedAt"
            color="error"
            variant="subtle"
            :title="`Anulada por ${pit.voidedBy?.name} el ${formatInstantInLima(pit.voidedAt)}`"
            :description="pit.voidReason ? `Motivo: ${pit.voidReason}` : undefined"
          />

          <UAlert
            v-if="pit.notes"
            color="neutral"
            variant="subtle"
            title="Nota:"
            :description="pit.notes"
          />

          <UAlert
            v-if="pit.vehicleId"
            color="primary"
            variant="subtle"
            title="Cambio de vehículo en esta parada"
          >
            <template v-if="pit.vehicleReason || pit.voidedAt" #description>
              <div class="flex flex-wrap items-center gap-2">
                <span v-if="pit.vehicleReason">— Motivo: {{ pit.vehicleReason }}</span>
                <UBadge
                  v-if="pit.voidedAt"
                  color="error"
                  variant="subtle"
                  label="(Revertido al anular la parada)"
                />
              </div>
            </template>
          </UAlert>

          <UPageGrid>
            <UPageCard title="Cuadre de envases" variant="soft">
              <ul>
                <li v-for="c in pit.counts" :key="c.id">
                  <span>{{ c.containerType.name }}:</span>
                  {{ c.countedFull }} ll (esp. {{ c.expectedFull }}), {{ c.countedEmpty }} vac (esp.
                  {{ c.expectedEmpty }})
                  <p v-if="c.differenceReason">Motivo: {{ c.differenceReason }}</p>
                </li>
              </ul>
            </UPageCard>

            <UPageCard
              v-if="!pit.unloads || pit.unloads.length === 0"
              title="Baja (descarga)"
              description="No hubo descarga"
              variant="soft"
            />
            <UPageCard v-else title="Baja (descarga)" variant="soft">
              <ul>
                <li v-for="(u, uIndex) in pit.unloads" :key="uIndex">
                  {{ u.type === "EMPTY_UNLOAD" ? "Vacíos descargados" : "Llenos vueltos" }}:
                  {{ u.quantity }} de {{ u.containerType.name }}
                </li>
              </ul>
            </UPageCard>

            <UPageCard
              v-if="!pit.loads || pit.loads.length === 0"
              title="Sube (carga)"
              description="No hubo carga"
              variant="soft"
            />
            <UPageCard v-else title="Sube (carga)" variant="soft">
              <ul>
                <li v-for="l in pit.loads" :key="l.id">
                  {{ l.quantity }} de {{ l.batchItem.containerType.name }} (Lote
                  {{ l.batchItem.batch.code }})
                </li>
              </ul>
            </UPageCard>

            <UPageCard
              v-if="pit.cashDelivered === null"
              title="Efectivo"
              description="No entregó efectivo"
              variant="soft"
            />
            <UPageCard v-else title="Efectivo" variant="soft">
              <div class="flex flex-wrap items-center gap-2">
                <span>Entregado:</span>
                <UBadge color="neutral" variant="subtle" :label="formatSoles(pit.cashDelivered)" />
              </div>
              <p v-if="pit.cashExpected !== null">
                Esperado: {{ formatSoles(pit.cashExpected) }} · Conserva:
                {{ formatSoles(subtractAmounts(pit.cashExpected, pit.cashDelivered)) }}
              </p>
              <p v-if="pit.cashReason">Motivo: {{ pit.cashReason }}</p>
            </UPageCard>
          </UPageGrid>
        </UPageCard>
      </template>
    </UPageList>
  </SectionCard>
</template>
