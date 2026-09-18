<script setup lang="ts">
/** Un negativo es una señal real: nunca se pone en cero, en valor absoluto ni se esconde. */
defineProps<{ value: number }>();
</script>

<template>
  <span v-if="value >= 0">{{ value }}</span>
  <span v-else class="inline-flex items-center gap-1 font-semibold text-error">
    <UIcon name="i-lucide-triangle-alert" class="size-3.5" aria-hidden="true" />
    <span aria-hidden="true">{{ value }}</span>
    <span class="sr-only"
      >{{ value }}: hay más envases llenados que vacíos registrados, faltan registrar entradas de
      envases</span
    >
  </span>
</template>
