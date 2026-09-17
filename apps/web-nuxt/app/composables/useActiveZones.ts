import type { Zone } from "@yacco/shared";

/**
 * El catálogo de zonas activas. Si falla, el selector queda en "Sin zona" y el
 * formulario sigue usable: la zona es opcional y no vale bloquear por ella.
 */
export function useActiveZones() {
  return useCatalog<Zone>("/zones", { active: true }).items;
}
