<script setup lang="ts">
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
</script>

<template>
  <div class="space-y-2">
    <h3 class="font-medium text-highlighted">{{ title }}</h3>
    <p class="text-sm text-muted">{{ description }}</p>
    <table class="w-full text-sm">
      <caption class="sr-only">
        {{
          caption
        }}
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
        <tr v-for="row in rows" :key="row.type.id">
          <td class="py-2 font-medium text-highlighted">{{ row.type.name }}</td>
          <td class="py-2 text-right tabular-nums">{{ row.expected }}</td>
          <td class="py-2 pl-6">
            <UInput
              v-model="counts[row.type.id]"
              type="number"
              :min="0"
              :step="1"
              :aria-label="`${inputLabel} ${row.type.name}`"
              :disabled="disabled"
              class="w-28"
            />
          </td>
          <td
            class="py-2 text-right font-medium tabular-nums"
            :class="gapOf(row) === 0 ? 'text-success' : 'text-warning'"
          >
            {{ gapOf(row) === 0 ? "Cuadra" : describeDifference(gapOf(row)) }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
