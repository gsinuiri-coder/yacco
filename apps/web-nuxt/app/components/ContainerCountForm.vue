<script setup lang="ts">
import type { ContainerBalanceRow, ContainerType } from "@yacco/shared";

/**
 * La planilla de conteo de una ubicación. El número del reporte va al lado
 * del campo, por tipo de envase: ver los dos juntos es el punto. Un campo en
 * blanco es "no contado" y se omite; "0" es un conteo real. Cuando algo
 * difiere, la diferencia se muestra antes de confirmar — es información, no
 * un error. La API emite el ajuste y sella la fecha; acá no se calcula nada
 * más que la vista previa.
 */
const props = defineProps<{ row: ContainerBalanceRow; containerTypes: ContainerType[] }>();
const emit = defineEmits<{ cancel: []; registered: [] }>();

const api = useApi();

interface CountLine {
  containerType: { id: string; name: string };
  expectedQuantity: number;
  counted: string;
}
interface ReviewedLine {
  containerType: { id: string; name: string };
  expectedQuantity: number;
  countedQuantity: number;
}

const lines = ref<CountLine[]>(
  props.row.containers.map((container) => ({
    containerType: container.containerType,
    expectedQuantity: container.quantity,
    counted: "",
  })),
);
const extraTypeId = ref("");
const validationError = ref<string | null>(null);
const review = ref<ReviewedLine[] | null>(null);
const submitting = ref(false);
const submitError = ref<string | null>(null);

const availableExtraTypes = computed(() =>
  props.containerTypes.filter(
    (type) => !lines.value.some((line) => line.containerType.id === type.id),
  ),
);

function updateCounted(containerTypeId: string, value: string): void {
  lines.value = lines.value.map((line) =>
    line.containerType.id === containerTypeId ? { ...line, counted: value } : line,
  );
  validationError.value = null;
}

function addExtraType(): void {
  const type = props.containerTypes.find((candidate) => candidate.id === extraTypeId.value);
  if (!type) return;
  // Un tipo que el sistema no listaba en esta ubicación: el reporte lo habría
  // mostrado si tuviera saldo, así que arranca de cero.
  lines.value = [
    ...lines.value,
    { containerType: { id: type.id, name: type.name }, expectedQuantity: 0, counted: "" },
  ];
  extraTypeId.value = "";
}

function reviewLines(): ReviewedLine[] | null {
  const reviewed: ReviewedLine[] = [];
  for (const line of lines.value) {
    if (line.counted.trim() === "") continue;
    const countedQuantity = parseCounted(line.counted);
    if (countedQuantity === null) {
      validationError.value = `Lo contado de ${line.containerType.name} debe ser un número entero, 0 o más`;
      return null;
    }
    reviewed.push({
      containerType: line.containerType,
      expectedQuantity: line.expectedQuantity,
      countedQuantity,
    });
  }
  if (reviewed.length === 0) {
    validationError.value = "Escribe lo contado de al menos un tipo de envase";
    return null;
  }
  return reviewed;
}

async function register(reviewed: ReviewedLine[]): Promise<void> {
  submitting.value = true;
  submitError.value = null;
  try {
    // Un conteo por tipo, en orden: cada uno es su propia entrada de sólo agregar.
    for (const line of reviewed) {
      await api.request("/container-counts", {
        method: "POST",
        body: {
          locationId: props.row.location.id,
          containerTypeId: line.containerType.id,
          countedQuantity: line.countedQuantity,
        },
      });
    }
    emit("registered");
  } catch (error) {
    // El mensaje de la API nombra el problema concreto: tal cual.
    submitError.value = describeApiFailure(error);
    submitting.value = false;
  }
}

function handleSubmit(): void {
  if (submitting.value) return;
  const reviewed = reviewLines();
  if (reviewed === null) return;

  const hasDifference = reviewed.some((line) => line.countedQuantity !== line.expectedQuantity);
  if (hasDifference) {
    review.value = reviewed;
    return;
  }
  void register(reviewed);
}
</script>

<template>
  <div
    v-if="review !== null"
    role="group"
    :aria-label="`Revisar conteo de ${row.location.name}`"
    class="space-y-3"
  >
    <p class="text-sm text-muted">
      Hay diferencias con lo que dice el sistema. Revisa antes de confirmar:
    </p>
    <ul class="list-disc space-y-1 pl-5 text-sm">
      <li v-for="line in review" :key="line.containerType.id">
        {{ line.containerType.name }}: según el sistema {{ line.expectedQuantity }}, contado
        {{ line.countedQuantity }}
        <template v-if="line.countedQuantity !== line.expectedQuantity">
          (diferencia {{ formatCountDifference(line.countedQuantity, line.expectedQuantity) }})
        </template>
      </li>
    </ul>
    <UAlert v-if="submitError" role="alert" color="error" variant="subtle" :title="submitError" />
    <div class="flex justify-end gap-2">
      <UButton
        color="neutral"
        variant="outline"
        label="Volver a contar"
        :disabled="submitting"
        @click="review = null"
      />
      <UButton
        :label="submitting ? 'Registrando…' : 'Confirmar conteo'"
        :disabled="submitting"
        @click="register(review)"
      />
    </div>
  </div>

  <form
    v-else
    class="space-y-4"
    novalidate
    :aria-label="`Contar envases de ${row.location.name}`"
    @submit.prevent="handleSubmit"
  >
    <p v-if="lines.length === 0" class="text-sm text-muted">
      El sistema no tiene envases de ningún tipo en esta ubicación. Agrega el tipo que encontraste,
      o registra 0 si no hay ninguno.
    </p>
    <div class="grid gap-4 sm:grid-cols-3">
      <UFormField
        v-for="line in lines"
        :key="line.containerType.id"
        :label="line.containerType.name"
        :help="`Según el sistema: ${line.expectedQuantity}`"
      >
        <UInput
          :model-value="line.counted"
          type="number"
          :min="0"
          :step="1"
          placeholder="Contado"
          :aria-label="`Contado de ${line.containerType.name}`"
          :disabled="submitting"
          class="w-full"
          @update:model-value="
            (value: string | number) => updateCounted(line.containerType.id, String(value))
          "
        />
      </UFormField>
      <UFormField v-if="availableExtraTypes.length > 0" label="Otro tipo de envase encontrado">
        <div class="flex gap-2">
          <USelect
            v-model="extraTypeId"
            :items="availableExtraTypes.map((type) => ({ label: type.name, value: type.id }))"
            placeholder="Selecciona un tipo"
            :disabled="submitting"
            class="w-full"
          />
          <UButton
            color="neutral"
            variant="outline"
            label="Agregar tipo"
            :disabled="submitting || extraTypeId === ''"
            @click="addExtraType"
          />
        </div>
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
        @click="$emit('cancel')"
      />
      <UButton
        type="submit"
        :label="submitting ? 'Registrando…' : 'Registrar conteo'"
        :disabled="submitting"
      />
    </div>
  </form>
</template>
