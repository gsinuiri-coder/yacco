<script setup lang="ts">
import { formatDebtBalance, formatSoles, isAboveZero } from "@yacco/shared";

/** Un monto en soles tal como llegó de la API: nunca pasa por Number. */
const props = defineProps<{
  value: string;
  /** Si es una deuda: en rojo cuando es mayor que cero, y «A favor» cuando es negativa. */
  debt?: boolean;
}>();

const owes = computed(() => props.debt === true && isAboveZero(props.value));
const text = computed(() =>
  props.debt === true ? formatDebtBalance(props.value) : formatSoles(props.value),
);
</script>

<template>
  <span class="tabular-nums" :class="owes ? 'font-semibold text-error' : undefined">{{
    text
  }}</span>
</template>
