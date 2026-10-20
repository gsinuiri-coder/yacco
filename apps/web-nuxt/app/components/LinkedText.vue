<script setup lang="ts">
/**
 * Un texto libre con sus enlaces http(s) abribles: una referencia con el link
 * de Google Maps que dejó el cliente. Sin `v-html`: cada trozo es un nodo, así
 * que lo que se escribió en la referencia se ve tal cual, marcas incluidas.
 */
const props = defineProps<{ text: string }>();

const segments = computed(() => splitLinks(props.text));
</script>

<template>
  <span
    ><template v-for="(segment, index) in segments" :key="index"
      ><ULink
        v-if="segment.kind === 'link'"
        :to="segment.href"
        external
        target="_blank"
        rel="noopener noreferrer"
        class="break-all underline"
        >{{ segment.href }}</ULink
      ><template v-else>{{ segment.text }}</template></template
    ></span
  >
</template>
