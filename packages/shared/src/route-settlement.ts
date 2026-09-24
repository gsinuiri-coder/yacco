/**
 * Contracts derived from apps/api/src/modules/route-settlement. Money is a
 * 2-decimal string end to end.
 *
 * The ledger view (`expected`) and the persisted row (`settlement`) share two
 * groups of fields: the full-container counts that come out of the ledger and
 * the route's money. They are declared once and composed, so a field added to
 * one side of the API cannot silently go missing on the other here.
 */

/** A container type named alongside its id: GET /container-types omits withdrawn types. */
interface NamedContainerType {
  containerTypeId: string;
  containerTypeName: string;
}

/** ContainerQuantityLineDto. */
export type ContainerQuantityLine = NamedContainerType & { quantity: number };

/** ContainerDifferenceLineDto: picked up per the ledger minus counted. */
export type ContainerDifferenceLine = NamedContainerType & { difference: number };

/** Full containers per the ledger, the same on both sides. */
export interface LedgerFullCounts {
  fullOut: number;
  fullDelivered: number;
  fullSold: number;
}

/** The route's money. `totalCollected` is CONFIRMED + PENDING; a REJECTED payment never adds. */
export interface RouteMoneyTotals {
  totalSold: string;
  totalCollected: string;
  totalCashCollected: string;
  totalPendingConfirmation: string;
  totalOnCredit: string;
}

/** RouteSettlementExpectedDto: everything from the ledger, no physical count. */
export interface RouteSettlementExpected extends LedgerFullCounts, RouteMoneyTotals {
  emptiesPickedUp: number;
  emptiesPickedUpByType: ContainerQuantityLine[];
}

/** RouteSettlementDto: the persisted row, with the two physical counts and who closed it. */
export interface RouteSettlement extends LedgerFullCounts, RouteMoneyTotals {
  routeId: string;
  fullReturned: number;
  emptiesCollected: number;
  emptiesCollectedByType: ContainerQuantityLine[];
  notes: string | null;
  settledById: string;
  settledAt: string;
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

/** CreateRouteSettlementResponseDto. Differences: 0 means it squared. */
export interface CreateRouteSettlementResponse {
  settlement: RouteSettlement;
  differences: RouteSettlementDifferences;
}

/** RouteSettlementDifferencesDto. The empties total can be 0 while two types compensate. */
export interface RouteSettlementDifferences {
  containers: number;
  empties: number;
  emptiesByType: ContainerDifferenceLine[];
}

/** CreateRouteSettlementDto: only what a person counts at the plant gate. */
export interface CreateRouteSettlementBody {
  fullReturned: number;
  /** Por tipo de envase; su suma es `fullReturned`. Cada línea repone el lote más antiguo que cargó la ruta. */
  fullReturnedByType?: Array<{ containerTypeId: string; quantity: number }>;
  emptiesCollected: Array<{ containerTypeId: string; quantity: number }>;
  notes?: string;
}

/** Full containers that should come back per the ledger, before counting. */
export function expectedFullReturn(counts: LedgerFullCounts): number {
  return counts.fullOut - (counts.fullDelivered + counts.fullSold);
}

/**
 * The container difference, same formula as the API: not persisted, because
 * everything that composes it already is.
 */
export function containerDifference(
  settlement: LedgerFullCounts & { fullReturned: number },
): number {
  return expectedFullReturn(settlement) - settlement.fullReturned;
}
