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
