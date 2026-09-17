<script setup lang="ts">
/** Un dato de lectura con su etiqueta y, si hace falta, la aclaración de qué significa. */
defineProps<{
  label: string;
  value?: string | number;
  note?: string;
  /** "warning" para un número que pide atención; "success" para uno que cuadró. */
  tone?: "warning" | "success";
}>();
</script>

<template>
  <div class="rounded-md bg-elevated px-4 py-3">
    <dt class="text-xs font-medium tracking-wide text-muted uppercase">{{ label }}</dt>
    <dd
      class="mt-1 text-xl font-semibold tabular-nums"
      :class="
        tone === 'warning'
          ? 'text-warning'
          : tone === 'success'
            ? 'text-success'
            : 'text-highlighted'
      "
    >
      <slot>{{ value }}</slot>
    </dd>
    <dd v-if="note" class="mt-0.5 text-xs text-muted">{{ note }}</dd>
  </div>
</template>
