<script setup lang="ts">
import type { SetupChecklist } from "@yacco/shared";

/**
 * «Puesta en marcha»: lo que le falta a la planta para operar con datos
 * reales (docs/carga-datos-reales.md). Solo para el administrador, que es
 * quien puede hacerlo. Cuando no queda nada, la tarjeta no está.
 *
 * Si la consulta falla, tampoco: es una ayuda, no algo que tape el Panel.
 */
const { data } = useReport<SetupChecklist>("/reports/setup-checklist");
const items = computed(() => (data.value === null ? [] : setupChecklistItems(data.value)));
</script>

<template>
  <SectionCard
    v-if="items.length > 0"
    title="Puesta en marcha"
    description="Lo que falta cargar antes de trabajar con los datos reales de la planta."
  >
    <UPageList as="ul">
      <UPageCard
        v-for="item in items"
        :key="item.text"
        as="li"
        variant="naked"
        orientation="horizontal"
        :description="item.text"
      >
        <UButton :to="item.to" variant="link" :label="item.linkLabel" />
      </UPageCard>
    </UPageList>
  </SectionCard>
</template>
