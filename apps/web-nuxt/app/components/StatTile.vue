<script setup lang="ts">
/**
 * Un dato de lectura con su etiqueta y, si hace falta, la aclaración de qué
 * significa. Va dentro de un `<dl>` (UPageGrid as="dl"), que pide `<dt>`/`<dd>`
 * hijos directos de este `<div>`: por eso no es una UPageCard, que los
 * envolvería en sus propios `<div>`.
 */
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
    <dd v-if="tone === 'warning'" class="mt-1 text-xl font-semibold text-warning">
      <slot>{{ value }}</slot>
    </dd>
    <dd v-else-if="tone === 'success'" class="mt-1 text-xl font-semibold text-success">
      <slot>{{ value }}</slot>
    </dd>
    <dd v-else class="mt-1 text-xl font-semibold text-highlighted">
      <slot>{{ value }}</slot>
    </dd>
    <dd v-if="note" class="mt-0.5 text-xs text-muted">{{ note }}</dd>
  </div>
</template>
