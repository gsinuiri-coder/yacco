<script setup lang="ts">
/**
 * Confirmación de retiro compartida por los catálogos gestionables (tipos de
 * envase, zonas, …): retirar cambia cómo agrupan o resuelven otros registros,
 * así que pide un paso explícito con la consecuencia dicha; reactivar, en
 * cambio, es un solo clic en esas mismas pantallas.
 */
defineProps<{ itemLabel: string; explanation: string; saving: boolean }>();
defineEmits<{ cancel: []; confirm: [] }>();
</script>

<template>
  <UAlert
    role="group"
    :aria-label="`Confirmar retiro de ${itemLabel}`"
    color="neutral"
    variant="subtle"
    :description="`¿Retirar «${itemLabel}»? ${explanation}`"
  >
    <template #actions>
      <UButton
        color="neutral"
        variant="outline"
        size="sm"
        label="No"
        :disabled="saving"
        @click="$emit('cancel')"
      />
      <UButton
        color="error"
        size="sm"
        :label="saving ? 'Retirando…' : 'Sí, retirar'"
        :disabled="saving"
        @click="$emit('confirm')"
      />
    </template>
  </UAlert>
</template>
