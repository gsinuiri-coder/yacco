<script setup lang="ts">
import type { Customer, Page } from "@yacco/shared";

/**
 * Elegir un cliente buscándolo: con cientos de clientes nunca es un
 * desplegable con todos cargados. Sólo ACTIVOS: un pedido no se toma contra un
 * cliente dado de baja, y el filtro de la lista de pedidos usa lo mismo.
 */
const props = withDefaults(
  defineProps<{ label: string; error?: string; placeholder?: string; disabled?: boolean }>(),
  { error: undefined, placeholder: "Nombre o teléfono", disabled: false },
);
const model = defineModel<Customer | null>({ required: true });

const api = useApi();
const term = ref("");
const settled = useDebounced(
  computed(() => term.value.trim()),
  300,
);
const results = ref<Customer[]>([]);
const searching = ref(false);
let latest = 0;

watch(settled, async (text) => {
  const current = ++latest;
  if (text === "") {
    results.value = [];
    return;
  }
  searching.value = true;
  try {
    const page = await api.request<Page<Customer>>("/customers", {
      query: { search: text, limit: 10, active: true },
    });
    if (current === latest) results.value = page.data;
  } catch {
    if (current === latest) results.value = [];
  } finally {
    if (current === latest) searching.value = false;
  }
});

// El elegido tiene que estar entre las opciones, o el campo quedaría vacío.
const items = computed(() => {
  const chosen = model.value;
  if (chosen === null || results.value.some((customer) => customer.id === chosen.id)) {
    return results.value;
  }
  return [chosen, ...results.value];
});
</script>

<template>
  <UFormField :label="props.label" :error="props.error">
    <UInputMenu
      v-model="model"
      v-model:search-term="term"
      :items="items"
      by="id"
      label-key="name"
      description-key="phone"
      ignore-filter
      :loading="searching"
      :placeholder="props.placeholder"
      :disabled="props.disabled"
      icon="i-lucide-search"
      :clear="{ 'aria-label': `Quitar ${props.label.toLowerCase()}` }"
      class="w-full"
    >
      <template #empty>
        <span class="text-muted">{{
          settled === ""
            ? "Escribe un nombre o un teléfono."
            : searching
              ? "Buscando…"
              : "Sin resultados"
        }}</span>
      </template>
    </UInputMenu>
  </UFormField>
</template>
