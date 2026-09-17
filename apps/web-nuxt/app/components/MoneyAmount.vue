<script setup lang="ts">
import { formatSoles, isAboveZero } from "@yacco/shared";

/** Un monto en soles tal como llegó de la API: nunca pasa por Number. */
const props = defineProps<{
  value: string;
  /** Si es una deuda: en rojo cuando es mayor que cero. */
  debt?: boolean;
}>();

const owes = computed(() => props.debt === true && isAboveZero(props.value));
</script>

<template>
  <span class="tabular-nums" :class="owes ? 'font-semibold text-error' : undefined">{{
    formatSoles(value)
  }}</span>
</template>
