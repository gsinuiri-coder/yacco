/**
 * Contracts derived from apps/api/src/modules/container-reconciliation.
 * `checkedAt` is an INSTANT (when the reconciliation ran), not a business day.
 */

/**
 * ContainerReconciliationDiscrepancyDto.
 *
 * `locationName` and `containerTypeName` can be null, and that is NOT a
 * formatting gap: it means that `locationId`/`containerTypeId` resolves
 * against no real row. The query uses a LEFT JOIN precisely so an orphan row
 * shows up instead of disappearing — the null is part of the finding.
 */
export interface ContainerReconciliationDiscrepancy {
  locationId: string | null;
  locationName: string | null;
  containerTypeId: string;
  containerTypeName: string | null;
  /** Rebuilt from `container_movements`, never read from the balance. */
  ledgerQuantity: number;
  /** What `customer_container_balances` has today. */
  materializedQuantity: number;
  /** `ledgerQuantity - materializedQuantity`: positive means the balance is short. */
  difference: number;
}

/** ContainerReconciliationResponseDto. */
export interface ContainerReconciliation {
  checkedAt: string;
  discrepancyCount: number;
  discrepancies: ContainerReconciliationDiscrepancy[];
}
