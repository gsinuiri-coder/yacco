<script setup lang="ts">
import type { PlantCount, PlantCountState } from "@yacco/shared";

/**
 * «Conteo de la planta»: el administrador cuenta en el galpón los vacíos o
 * los llenos de un tipo de envase y el sistema pasa a decir lo contado. Lo que
 * había sale de la misma fila del inventario que está en pantalla; cuando lo
 * contado difiere, se muestra la diferencia y se pide confirmar. Lo que se
 * anota en el libro lo decide la API (un ajuste por lote en los llenos).
 */
const props = defineProps<{ rows: InventoryRow[] }>();
const emit = defineEmits<{ cancel: []; registered: [count: PlantCount] }>();

const api = useApi();

const STATE_OPTIONS: { label: string; value: PlantCountState }[] = [
  { label: "Vacíos en planta", value: "EMPTY_AT_PLANT" },
  { label: "Llenos en planta", value: "FULL_AT_PLANT" },
];

const containerTypeId = ref(props.rows[0]?.containerTypeId ?? "");
const state = ref<PlantCountState>("EMPTY_AT_PLANT");
const counted = ref("");
const validationError = ref<string | null>(null);
const reviewing = ref<number | null>(null);
const submitting = ref(false);
const submitError = ref<string | null>(null);

const row = computed(() =>
  props.rows.find((item) => item.containerTypeId === containerTypeId.value),
);
const expected = computed(() => row.value?.byState[state.value] ?? 0);
const stateLabel = computed(() => CONTAINER_STATE_LABEL[state.value].toLowerCase());

watch([containerTypeId, state], () => {
  validationError.value = null;
  submitError.value = null;
});

async function register(countedQuantity: number): Promise<void> {
  submitting.value = true;
  submitError.value = null;
  try {
    const result = await api.request<PlantCount>("/container-counts/plant", {
      method: "POST",
      body: { containerTypeId: containerTypeId.value, state: state.value, countedQuantity },
    });
    emit("registered", result);
  } catch (error) {
    submitError.value = describeApiFailure(error);
    submitting.value = false;
  }
}

function handleSubmit(): void {
  if (submitting.value) return;
  const countedQuantity = parseCounted(counted.value);
  if (countedQuantity === null) {
    validationError.value = "Lo contado debe ser un número entero, 0 o más";
    return;
  }
  if (state.value === "FULL_AT_PLANT" && countedQuantity > expected.value) {
    validationError.value = `Se contaron ${countedQuantity} llenos y el sistema tiene ${expected.value}. Los llenos que faltan se anotan como lote en Producción.`;
    return;
  }
  if (countedQuantity !== expected.value) {
    reviewing.value = countedQuantity;
    return;
  }
  void register(countedQuantity);
}
</script>

<template>
  <div
    v-if="reviewing !== null"
    role="group"
    aria-label="Revisar conteo de la planta"
    class="space-y-3"
  >
    <p class="text-sm">
      {{ row?.containerTypeName }}, {{ stateLabel }}: según el sistema {{ expected }}, contado
      {{ reviewing }} (diferencia {{ formatCountDifference(reviewing, expected) }}).
    </p>
    <p v-if="state === 'FULL_AT_PLANT'" class="text-sm text-muted">
      Los llenos que faltan se descuentan de los lotes, empezando por el más viejo.
    </p>
    <UAlert v-if="submitError" role="alert" color="error" variant="subtle" :title="submitError" />
    <div class="flex justify-end gap-2">
      <UButton
        color="neutral"
        variant="outline"
        label="Volver a contar"
        :disabled="submitting"
        @click="reviewing = null"
      />
      <UButton
        :label="submitting ? 'Registrando…' : 'Confirmar diferencia'"
        :disabled="submitting"
        @click="register(reviewing)"
      />
    </div>
  </div>

  <form
    v-else
    class="space-y-4"
    novalidate
    aria-label="Contar la planta"
    @submit.prevent="handleSubmit"
  >
    <div class="grid gap-4 sm:grid-cols-3">
      <UFormField label="Tipo de envase">
        <USelect
          v-model="containerTypeId"
          :items="
            rows.map((item) => ({ label: item.containerTypeName, value: item.containerTypeId }))
          "
          :disabled="submitting"
          class="w-full"
        />
      </UFormField>
      <UFormField label="Qué se contó">
        <USelect v-model="state" :items="STATE_OPTIONS" :disabled="submitting" class="w-full" />
      </UFormField>
      <UFormField label="Contado" :help="`Según el sistema: ${expected}`">
        <UInput
          :model-value="counted"
          type="number"
          :min="0"
          :step="1"
          placeholder="Contado"
          :disabled="submitting"
          class="w-full"
          @update:model-value="
            (value: string | number) => {
              counted = String(value);
              validationError = null;
            }
          "
        />
      </UFormField>
    </div>

    <UAlert
      v-if="validationError"
      role="alert"
      color="error"
      variant="subtle"
      :title="validationError"
    />
    <UAlert v-if="submitError" role="alert" color="error" variant="subtle" :title="submitError" />

    <div class="flex justify-end gap-2 border-t border-default pt-4">
      <UButton
        color="neutral"
        variant="outline"
        label="Cancelar"
        :disabled="submitting"
        @click="emit('cancel')"
      />
      <UButton
        type="submit"
        :label="submitting ? 'Registrando…' : 'Registrar conteo'"
        :disabled="submitting"
      />
    </div>
  </form>
</template>
