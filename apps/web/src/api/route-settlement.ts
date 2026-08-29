/**
 * Contracts derived from apps/api/src/modules/route-settlement. Do not invent
 * fields here: if the API changes, this file is updated against the real DTOs.
 *
 * Todo el dinero es un string de 2 decimales en el cable y sigue siendo un
 * string acá — ver lib/money.ts.
 */
import type { ApiClient } from "./api-client";

/**
 * ContainerQuantityLineDto: una cantidad de envases con su tipo. El nombre
 * viaja con el id porque `GET /container-types` solo devuelve los activos, y
 * un tipo retirado que todavía vuelve del camión se vería como un UUID.
 */
export interface ContainerQuantityLine {
  containerTypeId: string;
  containerTypeName: string;
  quantity: number;
}

/** ContainerDifferenceLineDto: recogido según el libro menos contado. */
export interface ContainerDifferenceLine {
  containerTypeId: string;
  containerTypeName: string;
  difference: number;
}

/**
 * RouteSettlementExpectedDto: todo lo que sale del libro, sin ningún conteo
 * físico de por medio.
 */
export interface RouteSettlementExpected {
  fullOut: number;
  fullDelivered: number;
  fullSold: number;
  emptiesPickedUp: number;
  emptiesPickedUpByType: ContainerQuantityLine[];
  totalSold: string;
  /** CONFIRMED + PENDING; un pago REJECTED nunca suma acá. */
  totalCollected: string;
  totalCashCollected: string;
  totalPendingConfirmation: string;
  totalOnCredit: string;
}

/** RouteSettlementDto: la fila persistida, con los conteos físicos. */
export interface RouteSettlement {
  routeId: string;
  fullOut: number;
  fullDelivered: number;
  fullSold: number;
  fullReturned: number;
  emptiesCollected: number;
  /** Reconstruido de los EMPTY_UNLOAD que emitió la liquidación. */
  emptiesCollectedByType: ContainerQuantityLine[];
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
  /** El total puede dar cero mientras dos tipos se compensan. */
  emptiesByType: ContainerDifferenceLine[];
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
 * CreateRouteSettlementDto: lo único que escribe una persona, contado
 * físicamente en la puerta de la planta. Todo lo demás lo deriva la API del
 * libro y nunca se acepta del cliente.
 *
 * Los vacíos van por tipo: la liquidación emite un movimiento de envases por
 * cada línea, y un movimiento siempre nombra de qué tipo es.
 */
export interface CreateRouteSettlementBody {
  fullReturned: number;
  emptiesCollected: { containerTypeId: string; quantity: number }[];
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
