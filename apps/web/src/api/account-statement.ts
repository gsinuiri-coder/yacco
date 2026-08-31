/**
 * Contracts derived from apps/api/src/modules/customers's
 * GET /:id/account-statement. Do not invent fields here: if the API changes,
 * this file is updated against the real DTOs.
 *
 * `date` is typed as `string`, not `Date`: AccountStatementEntryDto declares
 * `date!: Date` server-side, but that's Nest's Swagger type — over the wire
 * it serializes to an ISO instant string, the same way orders.ts types
 * `createdAt`. formatBusinessDateTime (lib/business-date.ts) takes a string
 * and treats this as an instant, never a business date: this is
 * `soldAt`/`paidAt`, not a calendar day like `deliveryDate`.
 *
 * `from`/`to` are deliberately absent from this client: the UI doesn't offer
 * a date-range filter yet, so there is nothing to pass. Money fields
 * (amount/runningBalance/closingBalance/debtBalance) stay 2-decimal strings —
 * see lib/money.ts.
 */
import type { ApiClient } from "./api-client";
import type { PaymentStatus } from "./payments";

export type AccountStatementEntryType = "CHARGE" | "PAYMENT";

/** AccountStatementCustomerDto. */
export interface AccountStatementCustomer {
  id: string;
  name: string;
  debtBalance: string;
}

/**
 * AccountStatementEntryDto: one row of the interleaved ledger.
 * `saleId`/`locationName` are set only on a CHARGE; `paymentId`/
 * `paymentMethodName`/`status` only on a PAYMENT — `isOpeningBalance` and
 * `voidedAt` apply to both.
 */
export interface AccountStatementEntry {
  date: string;
  type: AccountStatementEntryType;
  amount: string;
  runningBalance: string;
  isOpeningBalance: boolean;
  saleId: string | null;
  locationName: string | null;
  paymentId: string | null;
  paymentMethodName: string | null;
  status: PaymentStatus | null;
  /**
   * Cuándo se anuló esta fila; null si sigue en pie. Anulada, `amount` es el
   * monto original y `runningBalance` no se movió. Declarado acá y todavía
   * sin pintar: este archivo es el contrato y se actualiza contra el DTO real
   * —esa es la regla de arriba—, pero mostrarlo en la tabla es el PR 3.
   */
  voidedAt: string | null;
}

/** AccountStatementResponseDto. */
export interface AccountStatement {
  customer: AccountStatementCustomer;
  openingBalance: string;
  entries: AccountStatementEntry[];
  closingBalance: string;
}

export function getAccountStatement(
  apiClient: ApiClient,
  customerId: string,
): Promise<AccountStatement> {
  return apiClient.request<AccountStatement>(`/customers/${customerId}/account-statement`);
}
