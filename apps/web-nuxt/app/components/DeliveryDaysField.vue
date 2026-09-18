<script setup lang="ts">
import type { Weekday } from "@yacco/shared";

const props = defineProps<{
  idPrefix: string;
  label: string;
  /** La edición en fila ya nombra los días por el nombre accesible de la fila. */
  hideLabel?: boolean;
  modelValue: Weekday[];
  disabled: boolean;
}>();
defineEmits<{ "update:modelValue": [Weekday[]] }>();
</script>

<template>
  <div>
    <span
      :id="`${props.idPrefix}-label`"
      :class="props.hideLabel ? 'sr-only' : 'text-sm font-medium text-default'"
    >
      {{ props.label }}
    </span>
    <div
      role="group"
      :aria-labelledby="`${props.idPrefix}-label`"
      class="mt-1.5 flex flex-wrap gap-x-4 gap-y-2"
    >
      <UCheckbox
        v-for="day in WEEKDAY_ORDER"
        :key="day"
        :model-value="props.modelValue.includes(day)"
        :label="WEEKDAY_LABEL[day]"
        :disabled="props.disabled"
        @update:model-value="$emit('update:modelValue', toggleDay(props.modelValue, day))"
      />
    </div>
  </div>
</template>
