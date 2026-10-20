<script setup lang="ts">
import type { ButtonProps } from "@nuxt/ui";

/**
 * Lo que ocupa el lugar de un recurso mientras no se puede mostrar: carga,
 * "no existe" (con la salida a su lista) o error con reintento. Cuando nada de
 * eso aplica, pinta el slot.
 */
const props = defineProps<{
  loading: boolean;
  slow: boolean;
  notFound: boolean;
  errorMessage: string | null;
  /** "cliente", "pedido", "ruta". */
  noun: string;
  /** Artículo del sustantivo: "el" / "la". */
  article: "el" | "la";
  backTo: string;
  backLabel: string;
  /** Cuando lo que no existe no es el recurso que se carga (la liquidación de una ruta inexistente). */
  notFoundTitle?: string;
}>();
const emit = defineEmits<{ retry: [] }>();

const notFoundActions = computed<ButtonProps[]>(() => [
  { to: props.backTo, color: "neutral", variant: "outline", label: props.backLabel },
]);
const errorActions = computed<ButtonProps[]>(() => [
  retryAction(() => emit("retry")),
  { to: props.backTo, color: "neutral", variant: "ghost", label: props.backLabel },
]);
</script>

<template>
  <UPageBody v-if="loading">
    <UAlert
      v-if="slow"
      role="status"
      color="neutral"
      variant="subtle"
      :title="SLOW_REQUEST_MESSAGE"
    />
    <!-- Sin la prop `loading`: pone aria-busy, y eso calla el role="status". -->
    <UEmpty>
      <template #leading>
        <UIcon name="i-lucide-loader-circle" class="size-8 animate-spin" aria-hidden="true" />
      </template>
      <template #description>
        <p role="status">Cargando {{ noun }}…</p>
      </template>
    </UEmpty>
  </UPageBody>
  <UEmpty
    v-else-if="notFound"
    :title="notFoundTitle ?? `${article === 'el' ? 'Ese' : 'Esa'} ${noun} no existe`"
    description="Puede que el enlace esté mal copiado."
    :actions="notFoundActions"
  />
  <UEmpty
    v-else-if="errorMessage"
    :title="`No se pudo cargar ${article} ${noun}`"
    :actions="errorActions"
  >
    <template #description>
      <p role="alert">{{ errorMessage }}</p>
    </template>
  </UEmpty>
  <slot v-else />
</template>
