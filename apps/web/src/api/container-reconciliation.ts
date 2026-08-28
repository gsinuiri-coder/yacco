/**
 * Contracts derived from apps/api/src/modules/container-reconciliation. Do
 * not invent fields here: if the API changes, this file is updated against
 * the real DTOs.
 *
 * `checkedAt` es un INSTANTE (cuándo se corrió el cuadre), no un día de
 * negocio — se muestra con `formatBusinessDateTime`.
 */
import type { ApiClient } from "./api-client";

/**
 * ContainerReconciliationDiscrepancyDto.
 *
 * `locationName` y `containerTypeName` pueden ser null, y eso NO es un hueco
 * de formato: significa que ese `locationId`/`containerTypeId` no resuelve
 * contra ninguna fila real. La consulta usa LEFT JOIN justamente para que una
 * fila huérfana aparezca en vez de desaparecer, así que el null es parte del
 * hallazgo y la pantalla lo dice con todas las letras.
 */
export interface ContainerReconciliationDiscrepancy {
  locationId: string | null;
  locationName: string | null;
  containerTypeId: string;
  containerTypeName: string | null;
  /** Reconstruido desde `container_movements`, nunca leído del saldo. */
  ledgerQuantity: number;
  /** Lo que hoy tiene `customer_container_balances`. */
  materializedQuantity: number;
  /** `ledgerQuantity - materializedQuantity`: positivo, al saldo le faltan. */
  difference: number;
}

/** ContainerReconciliationResponseDto. */
export interface ContainerReconciliation {
  checkedAt: string;
  discrepancyCount: number;
  discrepancies: ContainerReconciliationDiscrepancy[];
}

/**
 * Sin paginar y sin parámetros: es un diagnóstico sobre todo el parque, y
 * siempre responde 200 — un descuadre es un hallazgo que este endpoint
 * reporta, no un error HTTP. Solo ADMIN.
 */
export function getContainerReconciliation(apiClient: ApiClient): Promise<ContainerReconciliation> {
  return apiClient.request<ContainerReconciliation>("/container-reconciliation");
}
