<script setup lang="ts">
/**
 * Lo que ocupa el lugar de un recurso mientras no se puede mostrar: carga,
 * "no existe" (con la salida a su lista) o error con reintento. Cuando nada de
 * eso aplica, pinta el slot.
 */
defineProps<{
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
}>();
defineEmits<{ retry: [] }>();
</script>

<template>
  <UAlert
    v-if="slow && loading"
    role="status"
    color="neutral"
    variant="subtle"
    :title="SLOW_REQUEST_MESSAGE"
    class="mb-4"
  />
  <UCard v-if="loading">
    <p role="status" class="flex items-center gap-2 text-muted">
      <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" aria-hidden="true" />
      Cargando {{ noun }}…
    </p>
  </UCard>
  <UCard v-else-if="notFound">
    <div class="flex flex-col items-start gap-3">
      <p class="font-medium text-highlighted">
        {{ article === "el" ? "Ese" : "Esa" }} {{ noun }} no existe
      </p>
      <p class="text-muted">Puede que el enlace esté mal copiado.</p>
      <UButton :to="backTo" color="neutral" variant="outline" :label="backLabel" />
    </div>
  </UCard>
  <UCard v-else-if="errorMessage">
    <div class="flex flex-col items-start gap-3">
      <p class="font-medium text-highlighted">No se pudo cargar {{ article }} {{ noun }}</p>
      <p role="alert" class="text-muted">{{ errorMessage }}</p>
      <div class="flex gap-2">
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-rotate-cw"
          label="Reintentar"
          @click="$emit('retry')"
        />
        <UButton :to="backTo" color="neutral" variant="ghost" :label="backLabel" />
      </div>
    </div>
  </UCard>
  <slot v-else />
</template>
