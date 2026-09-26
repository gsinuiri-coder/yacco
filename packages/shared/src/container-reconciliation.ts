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

/**
 * Contracts derived from apps/api/src/modules/debt-reconciliation. Money is a
 * 2-decimal string, never a number. `customerId`/`customerName` null is the
 * finding (a sale whose location resolves to no customer), not a gap.
 */
export interface DebtReconciliationDiscrepancy {
  customerId: string | null;
  customerName: string | null;
  /** Rebuilt from sales and payments, never read from `debt_balance`. */
  ledgerBalance: string;
  /** What `customers.debt_balance` holds today. */
  materializedBalance: string;
  /** `ledgerBalance - materializedBalance`: positive means the balance is short. */
  difference: string;
}

/** DebtReconciliationResponseDto. */
export interface DebtReconciliation {
  checkedAt: string;
  discrepancyCount: number;
  discrepancies: DebtReconciliationDiscrepancy[];
}
