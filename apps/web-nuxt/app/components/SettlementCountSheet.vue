<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
import type { CountSheetRow } from "../utils/settlement";

/**
 * Una hoja de conteo de la liquidación: por tipo de envase, lo que dice el
 * libro, lo que se contó en la puerta y la diferencia mientras se escribe. La
 * usan los vacíos descargados y los llenos que volvieron; cada línea contada
 * es su propio movimiento de vuelta al galpón. Un campo vacío cuenta como
 * cero: el camión se descarga entero (ver `emptiesCountOrNull`).
 */
defineProps<{
  title: string;
  description: string;
  caption: string;
  /** Lo que antecede al nombre del tipo en la etiqueta de cada campo. */
  inputLabel: string;
  rows: CountSheetRow[];
  disabled: boolean;
}>();

const counts = defineModel<Record<string, string>>({ required: true });

function gapOf(row: CountSheetRow): number {
  return row.expected - (emptiesCountOrNull(counts.value[row.type.id] ?? "") ?? 0);
}

const columns: TableColumn<CountSheetRow>[] = [
  { id: "type", header: "Tipo de envase" },
  { accessorKey: "expected", header: "Según el libro", meta: RIGHT_ALIGNED },
  { id: "counted", header: "Contados" },
  { id: "gap", header: "Diferencia", meta: RIGHT_ALIGNED },
];
</script>

<template>
  <UPageCard variant="naked" :description="description">
    <template #title>
      <h3>{{ title }}</h3>
    </template>
    <UTable
      :data="rows"
      :columns="columns"
      :caption="caption"
      empty="No hay tipos de envase para contar."
    >
      <template #type-cell="{ row }">{{ row.original.type.name }}</template>
      <template #counted-cell="{ row }">
        <UInput
          v-model="counts[row.original.type.id]"
          type="number"
          :min="0"
          :step="1"
          :aria-label="`${inputLabel} ${row.original.type.name}`"
          :disabled="disabled"
        />
      </template>
      <template #gap-cell="{ row }">
        <UBadge
          :color="gapOf(row.original) === 0 ? 'success' : 'warning'"
          variant="subtle"
          :label="gapOf(row.original) === 0 ? 'Cuadra' : describeDifference(gapOf(row.original))"
        />
      </template>
    </UTable>
  </UPageCard>
</template>
