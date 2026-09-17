import type { Zone } from "@yacco/shared";

/**
 * El catálogo de zonas activas, de su propio endpoint. Si falla, el selector
 * queda en "Sin zona" y el resto del formulario sigue usable: la zona es
 * opcional y no vale bloquear un alta por ella.
 */
export function useActiveZones() {
  const api = useApi();
  const zones = ref<Zone[]>([]);

  onMounted(async () => {
    try {
      zones.value = await api.request<Zone[]>("/zones", { query: { active: true } });
    } catch {
      zones.value = [];
    }
  });

  return zones;
}
