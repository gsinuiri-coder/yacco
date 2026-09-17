import type { Page } from "@yacco/shared";
import type { Ref } from "vue";
import type { TransportRequest } from "../utils/api-transport";

export type ListQuery = NonNullable<TransportRequest["query"]>;

/**
 * Una lista paginada de la API: página, filtros, carga, error y reintento.
 *
 * La regla que manda sobre `page` (el bug que el web React arrastró semanas):
 * vuelve a 1 SÓLO cuando los filtros aplicados cambian de verdad. Un buscador
 * pasa acá su término YA esperado (useDebounced), y como un ref no avisa si se
 * le asigna el mismo valor, tipear una letra y borrarla no le quita al usuario
 * la página que eligió. Los valores vacíos no viajan: `zoneId=""` sería un 400.
 */
export function usePagedList<T>(path: string, pageSize: number, filters: Ref<ListQuery>) {
  const api = useApi();

  const page = ref(1);
  const result = shallowRef<Page<T> | null>(null);
  const loading = ref(true);
  const errorMessage = ref<string | null>(null);
  const reloads = ref(0);
  const slow = useSlowRequest(loading);
  let latest = 0;

  const applied = computed(() => {
    const query: ListQuery = {};
    for (const [key, value] of Object.entries(filters.value)) {
      if (value !== undefined && value !== "") query[key] = value;
    }
    return query;
  });
  const signature = computed(() => JSON.stringify(applied.value));

  watch(signature, () => {
    page.value = 1;
  });

  async function load(): Promise<void> {
    const current = ++latest;
    loading.value = true;
    errorMessage.value = null;
    try {
      const response = await api.request<Page<T>>(path, {
        query: { ...applied.value, page: page.value, limit: pageSize },
      });
      if (current === latest) result.value = response;
    } catch (error) {
      if (current === latest) errorMessage.value = describeApiFailure(error);
    } finally {
      if (current === latest) loading.value = false;
    }
  }

  watch([page, signature, reloads], load, { immediate: true });

  return {
    page,
    result,
    items: computed(() => result.value?.data ?? []),
    total: computed(() => result.value?.total ?? 0),
    totalPages: computed(() => result.value?.totalPages ?? 0),
    /** Lo que muestra "Página X de Y": la de la respuesta, no la pedida en vuelo. */
    shownPage: computed(() => result.value?.page ?? page.value),
    loading,
    firstLoad: computed(() => loading.value && result.value === null),
    errorMessage,
    slow,
    hasFilters: computed(() => signature.value !== "{}"),
    retry: () => {
      reloads.value++;
    },
    previous: () => {
      page.value = Math.max(1, page.value - 1);
    },
    next: () => {
      page.value++;
    },
  };
}
