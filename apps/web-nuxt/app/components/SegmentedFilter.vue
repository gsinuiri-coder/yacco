<script setup lang="ts" generic="T extends string">
/**
 * Un filtro de pocas opciones a la vista (Todos / Activos / Desactivados):
 * un clic en vez de abrir un desplegable. Cada botón dice si está elegido con
 * aria-pressed, y el grupo lleva el nombre del filtro.
 */
defineProps<{
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
}>();
const model = defineModel<T>({ required: true });
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <span class="text-sm font-medium text-default" aria-hidden="true">{{ label }}</span>
    <UFieldGroup role="group" :aria-label="label">
      <UButton
        v-for="option in options"
        :key="option.value"
        :label="option.label"
        :aria-pressed="model === option.value"
        :color="model === option.value ? 'primary' : 'neutral'"
        :variant="model === option.value ? 'subtle' : 'outline'"
        @click="model = option.value"
      />
    </UFieldGroup>
  </div>
</template>
