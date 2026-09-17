import type { Ref } from "vue";
import type { ListQuery } from "./usePagedList";

/**
 * Un catálogo sin paginar que llena un selector (choferes, zonas, métodos de
 * pago), leído de SU endpoint. Si falla, queda vacío y `failed` lo dice: la
 * pantalla decide si eso la bloquea o sólo deja el selector sin opciones.
 */
export function useCatalog<T>(path: string, query: ListQuery = {}) {
  const api = useApi();
  const items = ref<T[]>([]) as Ref<T[]>;
  const loading = ref(true);
  const failed = ref(false);

  async function load(): Promise<void> {
    loading.value = true;
    failed.value = false;
    try {
      items.value = await api.request<T[]>(path, { query });
    } catch {
      items.value = [];
      failed.value = true;
    } finally {
      loading.value = false;
    }
  }
  onMounted(load);

  return { items, loading, failed, reload: load };
}
