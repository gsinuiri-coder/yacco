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
  Vehicle,
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
const vehicles = ref<Vehicle[]>([]);

const notes = ref("");
const cashDelivered = ref("");
const cashReason = ref("");
const selectedVehicleId = ref<string | null>(null);
const vehicleReason = ref("");

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
    const [previewRes, batchesPage, vehiclesList] = await Promise.all([
      api.request<RoutePitStopPreviewResponse>(`/routes/${props.route.id}/pit-stops/preview`),
      api.request<Page<ProductionBatch>>("/production-batches", {
        query: { withStock: true, limit: PRODUCTION_BATCHES_MAX_LIMIT },
      }),
      api.request<Vehicle[]>("/vehicles", { query: { active: true } }),
    ]);
    preview.value = previewRes;
    batches.value = batchesPage.data;
    vehicles.value = vehiclesList;

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
    const raw = String(loadsState[c.containerTypeId] ?? "").trim();
    const qty = raw ? (countOrNull(raw) ?? 0) : 0;
    plans[c.containerTypeId] = planFifoLoad(batches.value, c.containerTypeId, qty);
  }
  return plans;
});

function getFifoPlan(containerTypeId: string) {
  return fifoPlans.value[containerTypeId] ?? null;
}

// Dinero: cálculo de lo que conserva
const cashPreserved = computed(() => {
  const raw = String(cashDelivered.value ?? "").trim();
  if (!preview.value || raw === "") return null;
  if (!isMoneyInput(raw)) return null;
  return subtractAmounts(preview.value.cash.cashExpected, raw);
});

const cashDeliveredExceedsExpected = computed(() => {
  const raw = String(cashDelivered.value ?? "").trim();
  if (!preview.value || raw === "") return false;
  if (!isMoneyInput(raw)) return false;
  const diff = subtractAmounts(raw, preview.value.cash.cashExpected);
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
    const reason = String(state.differenceReason ?? "").trim();
    if (diffFull !== 0 || diffEmpty !== 0) {
      if (!reason) {
        validationError.value = `Hay una diferencia en ${c.containerTypeName}. El motivo de la diferencia es obligatorio.`;
        return;
      }
    }
    countsPayload.push({
      containerTypeId: c.containerTypeId,
      countedFull: cFull,
      countedEmpty: cEmpty,
      ...(reason ? { differenceReason: reason } : {}),
    });
  }

  // Validar Baja
  const unloadEmptiesPayload = [];
  const returnFullsPayload = [];
  for (const c of preview.value.containers) {
    const state = getUnloadState(c.containerTypeId);
    const rawEmpty = String(state.unloadEmpties ?? "").trim();
    if (rawEmpty) {
      const qty = countOrNull(rawEmpty);
      if (qty === null || qty < 0) {
        validationError.value = `La cantidad de vacíos a bajar de ${c.containerTypeName} debe ser un entero mayor o igual a 0.`;
        return;
      }
      if (qty > 0) {
        unloadEmptiesPayload.push({ containerTypeId: c.containerTypeId, quantity: qty });
      }
    }
    const rawFull = String(state.returnFulls ?? "").trim();
    if (rawFull) {
      const qty = countOrNull(rawFull);
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
    const rawQty = String(loadsState[c.containerTypeId] ?? "").trim();
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
  const rawCash = String(cashDelivered.value ?? "").trim();
  const rawCashReason = String(cashReason.value ?? "").trim();
  const rawNotes = String(notes.value ?? "").trim();

  if (rawCash) {
    if (!isMoneyInput(rawCash)) {
      validationError.value = "El monto de efectivo entregado no es válido (ejemplo: 50.00).";
      return;
    }
    cashDeliveredVal = rawCash;
    if (cashDeliveredExceedsExpected.value) {
      if (!rawCashReason) {
        validationError.value = "Entregó más efectivo de lo esperado. El motivo es obligatorio.";
        return;
      }
      cashReasonVal = rawCashReason;
    }
  }

  submitting.value = true;
  try {
    const payload = {
      counts: countsPayload,
      ...(unloadEmptiesPayload.length > 0 ? { unloadEmpties: unloadEmptiesPayload } : {}),
      ...(returnFullsPayload.length > 0 ? { returnFulls: returnFullsPayload } : {}),
      ...(loadsPayload.length > 0 ? { loads: loadsPayload } : {}),
      ...(rawNotes ? { notes: rawNotes } : {}),
      ...(cashDeliveredVal ? { cashDelivered: cashDeliveredVal } : {}),
      ...(cashReasonVal ? { cashReason: cashReasonVal } : {}),
      ...(selectedVehicleId.value && selectedVehicleId.value !== props.route.vehicleId
        ? {
            vehicleId: selectedVehicleId.value,
            ...(vehicleReason.value.trim() ? { vehicleReason: vehicleReason.value.trim() } : {}),
          }
        : {}),
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
  <UPageList>
    <UPageCard
      variant="naked"
      orientation="horizontal"
      description="Cuadre de envases, descargas al galpón, recargas FIFO y entrega de efectivo."
    >
      <template #title><h3>Nueva parada en planta</h3></template>
      <div class="flex justify-end gap-2">
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-x"
          :disabled="submitting"
          aria-label="Cerrar formulario"
          @click="emit('cancel')"
        />
      </div>
    </UPageCard>

    <UAlert
      v-if="loading"
      role="status"
      color="neutral"
      variant="subtle"
      title="Cargando información de la parada en planta…"
    />

    <UAlert v-else-if="loadError" role="alert" color="error" variant="subtle" :title="loadError" />

    <UForm v-else :state="{}" :validate-on="[]" :loading-auto="false" novalidate @submit="submit">
      <!-- 1. CUADRE (obligatorio) -->
      <UPageCard
        description="Conteo de bidones arriba del camión al llegar a la planta. Si hay diferencia respecto al libro, el motivo es obligatorio."
        variant="outline"
      >
        <template #title><h4>1. Cuadre</h4></template>
        <UPageList>
          <UPageCard
            v-for="c in preview?.containers"
            :key="c.containerTypeId"
            variant="naked"
            :title="c.containerTypeName"
            :description="`Libro actual: ${c.expectedFull} llenos · ${c.expectedEmpty} vacíos${
              (c.previousFullDifferences ?? 0) !== 0 || (c.previousEmptyDifferences ?? 0) !== 0
                ? ` (dif. acumulada previa: ${formatDifference(c.previousFullDifferences ?? 0)} ll, ${formatDifference(c.previousEmptyDifferences ?? 0)} vac)`
                : ''
            }`"
          >
            <UPageGrid>
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
            </UPageGrid>

            <template
              v-if="
                getContainerDifferences(c.containerTypeId).diffFull !== 0 ||
                getContainerDifferences(c.containerTypeId).diffEmpty !== 0
              "
            >
              <UAlert
                color="warning"
                variant="subtle"
                :title="`Diferencia detectada: ${formatDifference(getContainerDifferences(c.containerTypeId).diffFull)} llenos, ${formatDifference(getContainerDifferences(c.containerTypeId).diffEmpty)} vacíos.`"
              />
              <UFormField :label="`Motivo de la diferencia de ${c.containerTypeName}`" required>
                <UInput
                  v-model="getCountState(c.containerTypeId).differenceReason"
                  placeholder="Explica la diferencia detectada"
                  :disabled="submitting"
                  class="w-full"
                />
              </UFormField>
            </template>
          </UPageCard>
        </UPageList>
      </UPageCard>

      <!-- 2. BAJA (opcional) -->
      <UPageCard
        description="Vacíos que bajan a la planta o llenos que vuelven al galpón. Dejar en blanco si no descarga de ese tipo."
        variant="outline"
      >
        <template #title><h4>2. Baja (descarga)</h4></template>
        <UPageList>
          <UPageGrid v-for="c in preview?.containers" :key="c.containerTypeId">
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
          </UPageGrid>
        </UPageList>
      </UPageCard>

      <!-- 3. SUBE (opcional) -->
      <UPageCard
        description="Llenos que suben al camión. Se consumen estrictamente del lote más antiguo con unidades en planta."
        variant="outline"
      >
        <template #title><h4>3. Sube (carga FIFO)</h4></template>
        <UPageList>
          <UPageList v-for="c in preview?.containers" :key="c.containerTypeId">
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
              <UPageCard
                v-if="(getFifoPlan(c.containerTypeId)?.lines.length ?? 0) > 0"
                title="Consumo FIFO planeado:"
                variant="soft"
              >
                <ul>
                  <li
                    v-for="line in getFifoPlan(c.containerTypeId)?.lines ?? []"
                    :key="line.batchItemId"
                  >
                    Lote {{ line.batchCode }} ({{ formatCalendarDay(line.batchDate) }}):
                    {{ line.quantity }} un.
                  </li>
                </ul>
              </UPageCard>
              <UAlert
                v-if="(getFifoPlan(c.containerTypeId)?.shortfall ?? 0) > 0"
                color="warning"
                variant="subtle"
                :title="`Stock insuficiente en planta: faltan ${getFifoPlan(c.containerTypeId)?.shortfall} unidades.`"
              />
            </template>
          </UPageList>
        </UPageList>
      </UPageCard>

      <!-- 4. EFECTIVO (opcional) -->
      <UPageCard
        description="Monto de dinero que el chofer entrega en la planta. Puede entregar parcial para conservar vuelto."
        variant="outline"
      >
        <template #title><h4>4. Efectivo</h4></template>
        <UPageGrid>
          <UPageCard
            title="Cobrado en ruta"
            :description="formatSoles(preview?.cash.cashCollected ?? '0.00')"
            variant="soft"
          />
          <UPageCard
            title="Entregado en paradas previas"
            :description="formatSoles(preview?.cash.cashDeliveredInPreviousPits ?? '0.00')"
            variant="soft"
          />
          <UPageCard
            title="Efectivo esperado"
            :description="formatSoles(preview?.cash.cashExpected ?? '0.00')"
            variant="soft"
            highlight
          />
        </UPageGrid>

        <UPageGrid>
          <UFormField label="Efectivo entregado">
            <UInput
              v-model="cashDelivered"
              placeholder="0.00"
              :disabled="submitting"
              class="w-full"
            />
          </UFormField>
          <UPageCard
            v-if="cashPreserved !== null"
            title="Conserva el chofer:"
            :description="formatSoles(cashPreserved)"
            variant="naked"
          />
        </UPageGrid>

        <template v-if="cashDeliveredExceedsExpected">
          <UAlert
            color="warning"
            variant="subtle"
            title="El chofer entrega más del efectivo esperado según el libro."
          />
          <UFormField label="Motivo por entregar más de lo esperado" required>
            <UInput
              v-model="cashReason"
              placeholder="Explica por qué entrega más dinero"
              :disabled="submitting"
              class="w-full"
            />
          </UFormField>
        </template>
      </UPageCard>

      <!-- CAMBIO DE VEHÍCULO (OPCIONAL) -->
      <UPageCard
        description="El cuadre de esta parada corresponde al vehículo que se deja. Si la ruta cambia de vehículo en este pit, el nuevo vehículo pasará a ser el actual."
        variant="outline"
      >
        <template #title><h4>Cambio de vehículo (opcional)</h4></template>
        <UFormField label="Cambia a vehículo">
          <USelect
            v-model="selectedVehicleId"
            :items="[
              { label: 'Conservar vehículo actual', value: null },
              ...vehicles.map((v) => ({ label: `${v.plate} (${v.name})`, value: v.id })),
            ]"
            :disabled="submitting"
            class="w-full"
          />
        </UFormField>

        <UFormField
          v-if="selectedVehicleId && selectedVehicleId !== route.vehicleId"
          label="Motivo del cambio de vehículo"
        >
          <UInput
            v-model="vehicleReason"
            placeholder="Ejemplo: Falla mecánica, cambio de chofer o mantenimiento"
            :disabled="submitting"
            class="w-full"
          />
        </UFormField>
      </UPageCard>

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

      <div class="flex justify-end gap-2">
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
    </UForm>
  </UPageList>
</template>
