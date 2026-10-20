<script setup lang="ts">
import type { Customer, Page } from "@yacco/shared";

/**
 * El trabajo entero del Panel: escribir nombre o teléfono y caer en la ficha
 * de ese cliente. Elegir navega; no queda nada seleccionado.
 *
 * NO filtra por activo, a diferencia del selector de clientes de un
 * formulario. Es un SUPUESTO DE TRABAJO, no un pedido del dueño: que un
 * cliente inactivo que todavía debe es justo a quien viene a buscar. Está en
 * docs/supuestos-por-validar.md; si el dueño dice lo contrario, el arreglo es
 * pasar `active: true`, no rediseñar la búsqueda.
 */
const SEARCH_DEBOUNCE_MS = 300;
const RESULTS_LIMIT = 10;

const api = useApi();

const term = ref("");
const open = ref(false);
const settledTerm = useDebounced(
  computed(() => term.value.trim()),
  SEARCH_DEBOUNCE_MS,
);
const results = ref<Customer[]>([]);
const searching = ref(false);
const errorMessage = ref<string | null>(null);
let latestSearch = 0;

async function search(text: string): Promise<void> {
  const current = ++latestSearch;
  if (text === "") {
    results.value = [];
    searching.value = false;
    errorMessage.value = null;
    return;
  }
  searching.value = true;
  errorMessage.value = null;
  try {
    const page = await api.request<Page<Customer>>("/customers", {
      query: { search: text, limit: RESULTS_LIMIT },
    });
    if (current === latestSearch) results.value = page.data;
  } catch (error) {
    if (current !== latestSearch) return;
    results.value = [];
    errorMessage.value = describeApiFailure(error);
  } finally {
    if (current === latestSearch) searching.value = false;
  }
}

watch(settledTerm, (text) => {
  void search(text);
});

function retry(): void {
  void search(settledTerm.value);
}
const errorActions = [retryAction(retry)];

async function pick(customer: Customer | undefined): Promise<void> {
  if (customer) await navigateTo(`/customers/${customer.id}`);
}
</script>

<template>
  <!-- Sin UFormField: su etiqueta no se oculta sin pisar el tema; el nombre va en aria-label. -->
  <UInputMenu
    v-model:search-term="term"
    v-model:open="open"
    aria-label="Buscar cliente"
    :items="results"
    label-key="name"
    description-key="phone"
    ignore-filter
    :reset-search-term-on-blur="false"
    :loading="searching"
    placeholder="Nombre o teléfono del cliente"
    icon="i-lucide-search"
    trailing-icon=""
    size="xl"
    autofocus
    class="w-full"
    @update:model-value="pick"
  >
    <template #item-label="{ item }">
      {{ item.name }}
      <UBadge v-if="!item.active" color="neutral" variant="subtle" size="sm" label="Inactivo" />
    </template>

    <template #empty>
      <p v-if="settledTerm === ''">Escribe un nombre o un teléfono.</p>
      <p v-else-if="searching">Buscando…</p>
      <UAlert
        v-else-if="errorMessage"
        role="alert"
        color="error"
        variant="subtle"
        :description="errorMessage"
        :actions="errorActions"
      />
      <p v-else>Sin resultados</p>
    </template>
  </UInputMenu>
</template>
