import type { Ref } from "vue";

/**
 * Un recurso de la API que una pantalla muestra entero (un cliente, un pedido,
 * una ruta): carga al montar, distingue "no existe" (404) de un error que vale
 * reintentar, y deja reemplazar el valor cuando una acción devuelve la versión
 * nueva sin volver a pedirla.
 */
export function useApiResource<T>(path: string) {
  const api = useApi();
  const data = ref<T | null>(null) as Ref<T | null>;
  const loading = ref(true);
  const error = ref<unknown>(null);
  const slow = useSlowRequest(loading);

  async function reload(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      data.value = await api.request<T>(path);
    } catch (caught) {
      error.value = caught;
    } finally {
      loading.value = false;
    }
  }
  onMounted(reload);

  return {
    data,
    loading,
    slow,
    notFound: computed(() => error.value instanceof ApiError && error.value.status === 404),
    errorMessage: computed(() => (error.value === null ? null : describeApiFailure(error.value))),
    reload,
  };
}
