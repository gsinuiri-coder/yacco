import type { Ref } from "vue";

/**
 * Un reporte de solo lectura (HU-19, HU-20, HU-21): lo carga al montar si quien
 * mira es administrador —la API los reserva a ese rol— y deja volver a pedirlo,
 * con otros filtros si el reporte los tiene.
 */
export function useReport<T>(path: string, query?: () => Record<string, string>) {
  const api = useApi();
  const session = useSession();
  const isAdmin = computed(() => session.hasRole("ADMIN"));
  const data = ref<T | null>(null) as Ref<T | null>;
  const loading = ref(true);
  const errorMessage = ref<string | null>(null);
  const slow = useSlowRequest(loading);

  async function load(): Promise<void> {
    if (!isAdmin.value) {
      loading.value = false;
      return;
    }
    loading.value = true;
    errorMessage.value = null;
    try {
      data.value = await api.request<T>(path, query ? { query: query() } : {});
    } catch (error) {
      errorMessage.value =
        error instanceof ApiError && error.status === 403
          ? "Este reporte es solo para administradores."
          : describeApiFailure(error);
    } finally {
      loading.value = false;
    }
  }
  onMounted(load);

  return { data, loading, slow, errorMessage, isAdmin, load };
}
