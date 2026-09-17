/**
 * Contracts derived from apps/api/src/modules/route-settlement. Money is a
 * 2-decimal string end to end.
 */

/** ContainerQuantityLineDto: the name travels with the id because GET /container-types omits withdrawn types. */
export interface ContainerQuantityLine {
  containerTypeId: string;
  containerTypeName: string;
  quantity: number;
}

/** ContainerDifferenceLineDto: picked up per the ledger minus counted. */
export interface ContainerDifferenceLine {
  containerTypeId: string;
  containerTypeName: string;
  difference: number;
}

/** RouteSettlementExpectedDto: everything from the ledger, no physical count. */
export interface RouteSettlementExpected {
  fullOut: number;
  fullDelivered: number;
  fullSold: number;
  emptiesPickedUp: number;
  emptiesPickedUpByType: ContainerQuantityLine[];
  totalSold: string;
  /** CONFIRMED + PENDING; a REJECTED payment never adds here. */
  totalCollected: string;
  totalCashCollected: string;
  totalPendingConfirmation: string;
  totalOnCredit: string;
}

/** RouteSettlementDto: the persisted row with the physical counts. */
export interface RouteSettlement {
  routeId: string;
  fullOut: number;
  fullDelivered: number;
  fullSold: number;
  fullReturned: number;
  emptiesCollected: number;
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

/** RouteSettlementDifferencesDto: 0 means it squared. */
export interface RouteSettlementDifferences {
  containers: number;
  empties: number;
  /** The total can be zero while two types compensate each other. */
  emptiesByType: ContainerDifferenceLine[];
}

/**
 * GetRouteSettlementResponseDto. `settlementOutdated` means exactly one thing:
 * a stop was corrected AFTER the settlement closed. It is not "the settlement
 * no longer matches the ledger" in general.
 */
export interface RouteSettlementView {
  expected: RouteSettlementExpected;
  settlement: RouteSettlement | null;
  unresolvedStops: number;
  settlementOutdated: boolean;
}

/** CreateRouteSettlementResponseDto. */
export interface CreateRouteSettlementResponse {
  settlement: RouteSettlement;
  differences: RouteSettlementDifferences;
}

/** CreateRouteSettlementDto: only what a person counts at the plant gate. */
export interface CreateRouteSettlementBody {
  fullReturned: number;
  emptiesCollected: Array<{ containerTypeId: string; quantity: number }>;
  notes?: string;
}

/** Full containers that should come back per the ledger, before counting. */
export function expectedFullReturn(expected: RouteSettlementExpected): number {
  return expected.fullOut - (expected.fullDelivered + expected.fullSold);
}

/**
 * The container difference, same formula as the API: not persisted, because
 * everything that composes it already is.
 */
export function containerDifference(settlement: RouteSettlement): number {
  return (
    settlement.fullOut - (settlement.fullDelivered + settlement.fullSold + settlement.fullReturned)
  );
}
