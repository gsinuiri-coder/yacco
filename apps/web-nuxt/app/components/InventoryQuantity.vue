<script setup lang="ts">
/** Un negativo es una señal real: nunca se pone en cero, en valor absoluto ni se esconde. */
defineProps<{ value: number }>();
</script>

<template>
  <span v-if="value >= 0">{{ value }}</span>
  <UBadge v-else color="error" variant="subtle" icon="i-lucide-triangle-alert">
    <span aria-hidden="true">{{ value }}</span>
    <span class="sr-only">{{ value }}: en negativo</span>
  </UBadge>
</template>
