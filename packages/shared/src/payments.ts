/**
 * Contracts derived from apps/api/src/modules/payments and payment-methods.
 *
 * An office payment (POST /payments) is ALWAYS written CONFIRMED, whatever the
 * method: the person typing it in is watching the money land.
 * `requiresConfirmation` only governs the driver's collection on a route, a
 * different write path. Never warn "this will stay pending" on the office form.
 *
 * A VOIDED payment (`voidedAt`) is not a REJECTED one: rejected means the money
 * never arrived; voided means it arrived and was recorded wrong. A voided row
 * still comes back, with its original amount.
 */

/** PaymentMethodResponseDto. With no params, the API lists only active methods. */
export interface PaymentMethod {
  id: string;
  name: string;
  active: boolean;
  requiresConfirmation: boolean;
}

/** Prisma enum PaymentStatus. */
export type PaymentStatus = "PENDING" | "CONFIRMED" | "REJECTED";

/** CreateOfficePaymentDto, without locationId (no endpoint lists locations) or paidAt (now). */
export interface CreateOfficePaymentBody {
  customerId: string;
  paymentMethodId: string;
  amount: string;
  /** UUID v4: a retry of this exact call reuses it, so it is never recorded twice. */
  idempotencyKey: string;
}

interface Ref {
  id: string;
  name: string;
}

interface UserRef {
  id: string;
  username: string;
}

/** PaymentRowDto. */
export interface PaymentRow {
  id: string;
  customer: Ref;
  location: Ref | null;
  paymentMethod: Ref;
  amount: string;
  status: PaymentStatus;
  paidAt: string;
  saleId: string | null;
  stopId: string | null;
  recordedBy: UserRef;
  confirmedAt: string | null;
  confirmedBy: UserRef | null;
  rejectedAt: string | null;
  rejectedBy: UserRef | null;
  rejectionReason: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  isOpeningBalance: boolean;
}

/** CreateOfficePaymentResponseDto. */
export interface CreateOfficePaymentResult {
  payment: PaymentRow;
  debtBalance: string;
  exceedsDebt: boolean;
}

/** PaymentTotalsDto: sums the FULL filtered set, never just the page on screen. */
export interface PaymentTotals {
  count: number;
  amount: string;
}

/** ListPaymentsQueryDto. `paidFrom`/`paidTo` are instants, not business days. */
export interface PaymentListQuery {
  page?: number;
  limit?: number;
  status?: PaymentStatus;
  paymentMethodId?: string;
  customerId?: string;
  paidFrom?: string;
  paidTo?: string;
  includeOpeningBalance?: boolean;
}

/** PaymentActionResponseDto. */
export interface PaymentActionResult {
  payment: PaymentRow;
  debtBalance: string;
}

export const PAYMENTS_PAGE_SIZE = 20;
