import type { PaymentStatus } from "./payments.js";

/**
 * GET /customers/:id/account-statement. `date` is an INSTANT (soldAt/paidAt),
 * never a business day. `openingBalance` is fixed at "0.00" when no `from` is
 * sent — it is not history and must not be shown; the roster carry-over is the
 * entry flagged `isOpeningBalance`. A voided entry keeps its original `amount`
 * and the API already leaves `runningBalance` untouched by it.
 */
export interface AccountStatementEntry {
  date: string;
  type: "CHARGE" | "PAYMENT";
  amount: string;
  runningBalance: string;
  isOpeningBalance: boolean;
  saleId: string | null;
  locationName: string | null;
  paymentId: string | null;
  paymentMethodName: string | null;
  status: PaymentStatus | null;
  voidedAt: string | null;
}

export interface AccountStatement {
  customer: { id: string; name: string; debtBalance: string };
  openingBalance: string;
  entries: AccountStatementEntry[];
  closingBalance: string;
}
