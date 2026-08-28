/**
 * Contracts derived from apps/api/src/modules/route-settlement. Do not invent
 * fields here: if the API changes, this file is updated against the real DTOs.
 *
 * Todo el dinero es un string de 2 decimales en el cable y sigue siendo un
 * string acá — ver lib/money.ts.
 */
import type { ApiClient } from "./api-client";

/**
 * RouteSettlementExpectedDto: todo lo que sale del libro, sin ningún conteo
 * físico de por medio.
 */
export interface RouteSettlementExpected {
  fullOut: number;
  fullDelivered: number;
  fullSold: number;
  emptiesPickedUp: number;
  totalSold: string;
  /** CONFIRMED + PENDING; un pago REJECTED nunca suma acá. */
  totalCollected: string;
  totalCashCollected: string;
  totalPendingConfirmation: string;
  totalOnCredit: string;
}

/** RouteSettlementDto: la fila persistida, con los dos conteos físicos. */
export interface RouteSettlement {
  routeId: string;
  fullOut: number;
  fullDelivered: number;
  fullSold: number;
  fullReturned: number;
  emptiesCollected: number;
  totalSold: string;
  totalCollected: string;
  totalCashCollected: string;
  totalPendingConfirmation: string;
  totalOnCredit: string;
  notes: string | null;
  settledById: string;
  settledAt: string;
}

/** RouteSettlementDifferencesDto: 0 significa que cuadró. */
export interface RouteSettlementDifferences {
  containers: number;
  empties: number;
}

/** GetRouteSettlementResponseDto: se sirve esté liquidada la ruta o no. */
export interface RouteSettlementView {
  expected: RouteSettlementExpected;
  settlement: RouteSettlement | null;
  unresolvedStops: number;
}

/** CreateRouteSettlementResponseDto. */
export interface CreateRouteSettlementResponse {
  settlement: RouteSettlement;
  differences: RouteSettlementDifferences;
}

/**
 * CreateRouteSettlementDto: los dos únicos números que escribe una persona,
 * contados físicamente en la puerta de la planta. Todo lo demás lo deriva la
 * API del libro y nunca se acepta del cliente.
 */
export interface CreateRouteSettlementBody {
  fullReturned: number;
  emptiesCollected: number;
  notes?: string;
}

export function getRouteSettlement(
  apiClient: ApiClient,
  routeId: string,
): Promise<RouteSettlementView> {
  return apiClient.request<RouteSettlementView>(`/routes/${routeId}/settlement`);
}

export function settleRoute(
  apiClient: ApiClient,
  routeId: string,
  body: CreateRouteSettlementBody,
): Promise<CreateRouteSettlementResponse> {
  return apiClient.request<CreateRouteSettlementResponse>(`/routes/${routeId}/settlement`, {
    method: "POST",
    body,
  });
}

/**
 * La diferencia de envases, con la misma fórmula que usa la API al liquidar:
 * `fullOut - (fullDelivered + fullSold + fullReturned)`. Se recalcula acá y
 * no se guarda, por la misma razón por la que el backend tampoco la
 * persiste — todo lo que la compone ya está registrado, y una copia podría
 * desfasarse de su propia fuente.
 */
export function containerDifference(settlement: RouteSettlement): number {
  return (
    settlement.fullOut - (settlement.fullDelivered + settlement.fullSold + settlement.fullReturned)
  );
}

/** Los llenos que deberían volver según el libro, antes de contarlos. */
export function expectedFullReturn(expected: RouteSettlementExpected): number {
  return expected.fullOut - (expected.fullDelivered + expected.fullSold);
}
