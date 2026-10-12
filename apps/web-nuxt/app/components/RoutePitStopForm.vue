<script setup lang="ts">
import {
  PRODUCTION_BATCHES_MAX_LIMIT,
  formatCalendarDay,
  formatSoles,
  isMoneyInput,
  subtractAmounts,
} from "@yacco/shared";
import type {
  Page,
  ProductionBatch,
  Route,
  RoutePitStopContainerPreview,
  RoutePitStopPreviewResponse,
  RoutePitStopResponse,
} from "@yacco/shared";
import { planFifoLoad } from "~/utils/fifo-load";
import { countOrNull, formatDifference } from "~/utils/settlement";

const props = defineProps<{ route: Route }>();
const emit = defineEmits<{
  cancel: [];
  created: [pit: RoutePitStopResponse];
}>();

const api = useApi();

const loading = ref(true);
const loadError = ref<string | null>(null);
const submitting = ref(false);
const submitError = ref<string | null>(null);
const validationError = ref<string | null>(null);

const preview = ref<RoutePitStopPreviewResponse | null>(null);
const batches = ref<ProductionBatch[]>([]);

const notes = ref("");
const cashDelivered = ref("");
const cashReason = ref("");

interface CountStateItem {
  countedFull: string;
  countedEmpty: string;
  differenceReason: string;
}

interface UnloadStateItem {
  unloadEmpties: string;
  returnFulls: string;
}

// Cuadre
const countsState = reactive<Record<string, CountStateItem>>({});

// Baja
const unloadsState = reactive<Record<string, UnloadStateItem>>({});

// Sube
const loadsState = reactive<Record<string, string>>({});

function getCountState(typeId: string): CountStateItem {
  let state = countsState[typeId];
  if (!state) {
    state = { countedFull: "", countedEmpty: "", differenceReason: "" };
    countsState[typeId] = state;
  }
  return state;
}

function getUnloadState(typeId: string): UnloadStateItem {
  let state = unloadsState[typeId];
  if (!state) {
    state = { unloadEmpties: "", returnFulls: "" };
    unloadsState[typeId] = state;
  }
  return state;
}

async function loadData(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    const [previewRes, batchesPage] = await Promise.all([
      api.request<RoutePitStopPreviewResponse>(`/routes/${props.route.id}/pit-stops/preview`),
      api.request<Page<ProductionBatch>>("/production-batches", {
        query: { withStock: true, limit: PRODUCTION_BATCHES_MAX_LIMIT },
      }),
    ]);
    preview.value = previewRes;
    batches.value = batchesPage.data;

    // Inicializar estado de cuadre con lo esperado por defecto
    for (const c of previewRes.containers) {
      countsState[c.containerTypeId] = {
        countedFull: String(c.expectedFull),
        countedEmpty: String(c.expectedEmpty),
        differenceReason: "",
      };
      unloadsState[c.containerTypeId] = {
        unloadEmpties: "",
        returnFulls: "",
      };
      loadsState[c.containerTypeId] = "";
    }
  } catch (error) {
    loadError.value = describeApiFailure(error);
  } finally {
    loading.value = false;
  }
}

onMounted(loadData);

// Sube FIFO plans
const fifoPlans = computed(() => {
  if (!preview.value) return {};
  const plans: Record<string, ReturnType<typeof planFifoLoad>> = {};
  for (const c of preview.value.containers) {
    const qty = countOrNull(loadsState[c.containerTypeId] ?? "") ?? 0;
    plans[c.containerTypeId] = planFifoLoad(batches.value, c.containerTypeId, qty);
  }
  return plans;
});

function getFifoPlan(containerTypeId: string) {
  return fifoPlans.value[containerTypeId] ?? null;
}

// Dinero: cálculo de lo que conserva
const cashPreserved = computed(() => {
  if (!preview.value || cashDelivered.value.trim() === "") return null;
  if (!isMoneyInput(cashDelivered.value.trim())) return null;
  return subtractAmounts(preview.value.cash.cashExpected, cashDelivered.value.trim());
});

const cashDeliveredExceedsExpected = computed(() => {
  if (!preview.value || cashDelivered.value.trim() === "") return false;
  if (!isMoneyInput(cashDelivered.value.trim())) return false;
  const diff = subtractAmounts(cashDelivered.value.trim(), preview.value.cash.cashExpected);
  return !diff.startsWith("-") && diff !== "0.00";
});

function getContainerDifferences(containerTypeId: string) {
  const item = preview.value?.containers.find(
    (c: RoutePitStopContainerPreview) => c.containerTypeId === containerTypeId,
  );
  if (!item) return { diffFull: 0, diffEmpty: 0 };
  const state = getCountState(containerTypeId);
  const cFull = countOrNull(state.countedFull);
  const cEmpty = countOrNull(state.countedEmpty);
  return {
    diffFull: cFull !== null ? cFull - item.expectedFull : 0,
    diffEmpty: cEmpty !== null ? cEmpty - item.expectedEmpty : 0,
  };
}

async function submit(): Promise<void> {
  if (submitting.value || !preview.value) return;
  validationError.value = null;
  submitError.value = null;

  // Validar Cuadre
  const countsPayload = [];
  for (const c of preview.value.containers) {
    const state = getCountState(c.containerTypeId);
    const cFull = countOrNull(state.countedFull);
    if (cFull === null || cFull < 0) {
      validationError.value = `Los llenos contados de ${c.containerTypeName} deben ser un número entero mayor o igual a 0.`;
      return;
    }
    const cEmpty = countOrNull(state.countedEmpty);
    if (cEmpty === null || cEmpty < 0) {
      validationError.value = `Los vacíos contados de ${c.containerTypeName} deben ser un número entero mayor o igual a 0.`;
      return;
    }
    const diffFull = cFull - c.expectedFull;
    const diffEmpty = cEmpty - c.expectedEmpty;
    if (diffFull !== 0 || diffEmpty !== 0) {
      if (!state.differenceReason.trim()) {
        validationError.value = `Hay una diferencia en ${c.containerTypeName}. El motivo de la diferencia es obligatorio.`;
        return;
      }
    }
    countsPayload.push({
      containerTypeId: c.containerTypeId,
      countedFull: cFull,
      countedEmpty: cEmpty,
      ...(state.differenceReason.trim() ? { differenceReason: state.differenceReason.trim() } : {}),
    });
  }

  // Validar Baja
  const unloadEmptiesPayload = [];
  const returnFullsPayload = [];
  for (const c of preview.value.containers) {
    const state = getUnloadState(c.containerTypeId);
    if (state.unloadEmpties.trim()) {
      const qty = countOrNull(state.unloadEmpties);
      if (qty === null || qty < 0) {
        validationError.value = `La cantidad de vacíos a bajar de ${c.containerTypeName} debe ser un entero mayor o igual a 0.`;
        return;
      }
      if (qty > 0) {
        unloadEmptiesPayload.push({ containerTypeId: c.containerTypeId, quantity: qty });
      }
    }
    if (state.returnFulls.trim()) {
      const qty = countOrNull(state.returnFulls);
      if (qty === null || qty < 0) {
        validationError.value = `La cantidad de llenos a retornar de ${c.containerTypeName} debe ser un entero mayor o igual a 0.`;
        return;
      }
      if (qty > 0) {
        returnFullsPayload.push({ containerTypeId: c.containerTypeId, quantity: qty });
      }
    }
  }

  // Validar Sube
  const loadsPayload = [];
  for (const c of preview.value.containers) {
    const rawQty = loadsState[c.containerTypeId]?.trim() ?? "";
    if (rawQty) {
      const qty = countOrNull(rawQty);
      if (qty === null || qty < 0) {
        validationError.value = `La cantidad de llenos a subir de ${c.containerTypeName} debe ser un entero mayor o igual a 0.`;
        return;
      }
      if (qty > 0) {
        const plan = getFifoPlan(c.containerTypeId);
        if (plan && plan.shortfall > 0) {
          validationError.value = `No hay suficiente stock en planta para subir ${qty} de ${c.containerTypeName} (faltan ${plan.shortfall} unidades).`;
          return;
        }
        if (plan) {
          for (const line of plan.lines) {
            loadsPayload.push({
              batchItemId: line.batchItemId,
              quantity: line.quantity,
            });
          }
        }
      }
    }
  }

  // Validar Efectivo
  let cashDeliveredVal: string | undefined = undefined;
  let cashReasonVal: string | undefined = undefined;
  if (cashDelivered.value.trim()) {
    const val = cashDelivered.value.trim();
    if (!isMoneyInput(val)) {
      validationError.value = "El monto de efectivo entregado no es válido (ejemplo: 50.00).";
      return;
    }
    cashDeliveredVal = val;
    if (cashDeliveredExceedsExpected.value) {
      if (!cashReason.value.trim()) {
        validationError.value = "Al entregar más efectivo del esperado, el motivo es obligatorio.";
        return;
      }
      cashReasonVal = cashReason.value.trim();
    }
  }

  submitting.value = true;
  try {
    const payload = {
      counts: countsPayload,
      ...(unloadEmptiesPayload.length > 0 ? { unloadEmpties: unloadEmptiesPayload } : {}),
      ...(returnFullsPayload.length > 0 ? { returnFulls: returnFullsPayload } : {}),
      ...(loadsPayload.length > 0 ? { loads: loadsPayload } : {}),
      ...(notes.value.trim() ? { notes: notes.value.trim() } : {}),
      ...(cashDeliveredVal ? { cashDelivered: cashDeliveredVal } : {}),
      ...(cashReasonVal ? { cashReason: cashReasonVal } : {}),
    };

    const res = await api.request<RoutePitStopResponse>(`/routes/${props.route.id}/pit-stops`, {
      method: "POST",
      body: payload,
    });
    emit("created", res);
  } catch (error) {
    submitError.value = describeApiFailure(error);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between border-b border-default pb-3">
      <div>
        <h3 class="text-base font-semibold text-highlighted">Nueva parada en planta</h3>
        <p class="text-sm text-muted">
          Cuadre de envases, descargas al galpón, recargas FIFO y entrega de efectivo.
        </p>
      </div>
      <UButton
        color="neutral"
        variant="ghost"
        icon="i-lucide-x"
        :disabled="submitting"
        aria-label="Cerrar formulario"
        @click="emit('cancel')"
      />
    </div>

    <div v-if="loading" class="py-6 text-center text-sm text-muted">
      Cargando información de la parada en planta…
    </div>

    <UAlert v-else-if="loadError" role="alert" color="error" variant="subtle" :title="loadError" />

    <form v-else class="space-y-6" novalidate @submit.prevent="submit">
      <!-- 1. CUADRE (obligatorio) -->
      <div class="space-y-4 rounded-lg border border-default bg-elevated/40 p-4">
        <div>
          <h4 class="font-semibold text-highlighted">1. Cuadre</h4>
          <p class="text-xs text-muted">
            Conteo de bidones arriba del camión al llegar a la planta. Si hay diferencia respecto al
            libro, el motivo es obligatorio.
          </p>
        </div>

        <div class="divide-y divide-default space-y-4">
          <div
            v-for="c in preview?.containers"
            :key="c.containerTypeId"
            class="space-y-2 pt-3 first:pt-0"
          >
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="font-medium text-highlighted">{{ c.containerTypeName }}</span>
              <span class="text-xs text-muted">
                Libro actual: {{ c.expectedFull }} llenos · {{ c.expectedEmpty }} vacíos
                <template
                  v-if="
                    (c.previousFullDifferences ?? 0) !== 0 ||
                    (c.previousEmptyDifferences ?? 0) !== 0
                  "
                >
                  (dif. acumulada previa:
                  {{ formatDifference(c.previousFullDifferences ?? 0) }} ll,
                  {{ formatDifference(c.previousEmptyDifferences ?? 0) }} vac)
                </template>
              </span>
            </div>

            <div class="grid gap-3 sm:grid-cols-2">
              <UFormField :label="`Llenos contados de ${c.containerTypeName}`">
                <UInput
                  v-model="getCountState(c.containerTypeId).countedFull"
                  type="number"
                  min="0"
                  :disabled="submitting"
                  class="w-full"
                />
              </UFormField>
              <UFormField :label="`Vacíos contados de ${c.containerTypeName}`">
                <UInput
                  v-model="getCountState(c.containerTypeId).countedEmpty"
                  type="number"
                  min="0"
                  :disabled="submitting"
                  class="w-full"
                />
              </UFormField>
            </div>

            <div
              v-if="
                getContainerDifferences(c.containerTypeId).diffFull !== 0 ||
                getContainerDifferences(c.containerTypeId).diffEmpty !== 0
              "
              class="space-y-2 rounded-md bg-warning/10 p-3"
            >
              <p class="text-xs font-medium text-warning">
                Diferencia detectada:
                {{ formatDifference(getContainerDifferences(c.containerTypeId).diffFull) }} llenos,
                {{ formatDifference(getContainerDifferences(c.containerTypeId).diffEmpty) }} vacíos.
              </p>
              <UFormField :label="`Motivo de la diferencia de ${c.containerTypeName}`" required>
                <UInput
                  v-model="getCountState(c.containerTypeId).differenceReason"
                  placeholder="Explica la diferencia detectada"
                  :disabled="submitting"
                  class="w-full"
                />
              </UFormField>
            </div>
          </div>
        </div>
      </div>

      <!-- 2. BAJA (opcional) -->
      <div class="space-y-4 rounded-lg border border-default bg-elevated/40 p-4">
        <div>
          <h4 class="font-semibold text-highlighted">2. Baja (descarga)</h4>
          <p class="text-xs text-muted">
            Vacíos que bajan a la planta o llenos que vuelven al galpón. Dejar en blanco si no
            descarga de ese tipo.
          </p>
        </div>

        <div class="space-y-3">
          <div
            v-for="c in preview?.containers"
            :key="c.containerTypeId"
            class="grid gap-3 sm:grid-cols-2"
          >
            <UFormField :label="`Vacíos que bajan de ${c.containerTypeName}`">
              <UInput
                v-model="getUnloadState(c.containerTypeId).unloadEmpties"
                type="number"
                min="0"
                placeholder="0"
                :disabled="submitting"
                class="w-full"
              />
            </UFormField>
            <UFormField :label="`Llenos que vuelven al galpón de ${c.containerTypeName}`">
              <UInput
                v-model="getUnloadState(c.containerTypeId).returnFulls"
                type="number"
                min="0"
                placeholder="0"
                :disabled="submitting"
                class="w-full"
              />
            </UFormField>
          </div>
        </div>
      </div>

      <!-- 3. SUBE (opcional) -->
      <div class="space-y-4 rounded-lg border border-default bg-elevated/40 p-4">
        <div>
          <h4 class="font-semibold text-highlighted">3. Sube (carga FIFO)</h4>
          <p class="text-xs text-muted">
            Llenos que suben al camión. Se consumen estrictamente del lote más antiguo con unidades
            en planta.
          </p>
        </div>

        <div class="space-y-4">
          <div v-for="c in preview?.containers" :key="c.containerTypeId" class="space-y-2">
            <UFormField :label="`Llenos que suben de ${c.containerTypeName}`">
              <UInput
                v-model="loadsState[c.containerTypeId]"
                type="number"
                min="0"
                placeholder="0"
                :disabled="submitting"
                class="w-full"
              />
            </UFormField>

            <!-- Plan FIFO detalle -->
            <template v-if="getFifoPlan(c.containerTypeId)">
              <div
                v-if="(getFifoPlan(c.containerTypeId)?.lines.length ?? 0) > 0"
                class="space-y-1 rounded-md bg-default p-2 text-xs text-muted"
              >
                <p class="font-medium text-highlighted">Consumo FIFO planeado:</p>
                <ul class="list-disc space-y-0.5 pl-4">
                  <li
                    v-for="line in getFifoPlan(c.containerTypeId)?.lines ?? []"
                    :key="line.batchItemId"
                  >
                    Lote {{ line.batchCode }} ({{ formatCalendarDay(line.batchDate) }}):
                    {{ line.quantity }} un.
                  </li>
                </ul>
              </div>
              <p
                v-if="(getFifoPlan(c.containerTypeId)?.shortfall ?? 0) > 0"
                class="text-xs text-warning"
              >
                Stock insuficiente en planta: faltan
                {{ getFifoPlan(c.containerTypeId)?.shortfall }} unidades.
              </p>
            </template>
          </div>
        </div>
      </div>

      <!-- 4. EFECTIVO (opcional) -->
      <div class="space-y-4 rounded-lg border border-default bg-elevated/40 p-4">
        <div>
          <h4 class="font-semibold text-highlighted">4. Efectivo</h4>
          <p class="text-xs text-muted">
            Monto de dinero que el chofer entrega en la planta. Puede entregar parcial para
            conservar vuelto.
          </p>
        </div>

        <dl class="grid gap-3 text-sm sm:grid-cols-3">
          <div class="rounded-md bg-default p-3">
            <dt class="text-xs text-muted">Cobrado en ruta</dt>
            <dd class="font-medium text-highlighted">
              {{
                formatSoles(
                  preview?.cash.cashCollectedInRoute ?? preview?.cash.cashCollected ?? "0.00",
                )
              }}
            </dd>
          </div>
          <div class="rounded-md bg-default p-3">
            <dt class="text-xs text-muted">Entregado en paradas previas</dt>
            <dd class="font-medium text-highlighted">
              {{ formatSoles(preview?.cash.cashDeliveredInPreviousPits ?? "0.00") }}
            </dd>
          </div>
          <div class="rounded-md bg-default p-3">
            <dt class="text-xs text-muted">Efectivo esperado</dt>
            <dd class="font-semibold text-primary">
              {{ formatSoles(preview?.cash.cashExpected ?? "0.00") }}
            </dd>
          </div>
        </dl>

        <div class="grid gap-3 sm:grid-cols-2">
          <UFormField label="Efectivo entregado">
            <UInput
              v-model="cashDelivered"
              placeholder="0.00"
              :disabled="submitting"
              class="w-full"
            />
          </UFormField>
          <div v-if="cashPreserved !== null" class="flex flex-col justify-center">
            <span class="text-xs text-muted">Conserva el chofer:</span>
            <span class="font-medium text-highlighted">{{ formatSoles(cashPreserved) }}</span>
          </div>
        </div>

        <div v-if="cashDeliveredExceedsExpected" class="space-y-2 rounded-md bg-warning/10 p-3">
          <p class="text-xs font-medium text-warning">
            El chofer entrega más del efectivo esperado según el libro.
          </p>
          <UFormField label="Motivo por entregar más de lo esperado" required>
            <UInput
              v-model="cashReason"
              placeholder="Explica por qué entrega más dinero"
              :disabled="submitting"
              class="w-full"
            />
          </UFormField>
        </div>
      </div>

      <!-- NOTAS -->
      <UFormField label="Observaciones (opcional)">
        <UInput
          v-model="notes"
          placeholder="Comentarios u observaciones de la parada"
          :disabled="submitting"
          class="w-full"
        />
      </UFormField>

      <UAlert
        v-if="validationError"
        role="alert"
        color="error"
        variant="subtle"
        :title="validationError"
      />
      <UAlert v-if="submitError" role="alert" color="error" variant="subtle" :title="submitError" />

      <div class="flex items-center justify-end gap-3 border-t border-default pt-4">
        <UButton
          color="neutral"
          variant="outline"
          label="Cancelar"
          :disabled="submitting"
          @click="emit('cancel')"
        />
        <UButton
          type="submit"
          :disabled="submitting"
          :label="submitting ? 'Registrando…' : 'Registrar parada en planta'"
        />
      </div>
    </form>
  </div>
</template>
