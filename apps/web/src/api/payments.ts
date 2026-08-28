/**
 * Contracts derived from apps/api/src/modules/payments. Do not invent fields
 * here: if the API changes, this file is updated against the real DTOs.
 *
 * `locationId` is deliberately absent from CreateOfficePaymentBody: the API
 * accepts an optional one, but there is no way for this screen to offer a
 * customer's location (same reasoning as customer-prices.ts). `paidAt` is
 * absent too — an office collection is recorded the moment it happens, so
 * the API's own default (now) is always the right value.
 *
 * `PaymentMethod.requiresConfirmation` (payment-methods.ts) does NOT apply
 * to this endpoint. PaymentsService.createOfficePayment always writes
 * status: CONFIRMED, whatever the method — the person typing this in IS
 * looking at the money land, so there is nothing left to confirm afterward.
 * `requiresConfirmation` only governs the driver's dispatch/route
 * collection (SalesService), a different write path entirely. A UI here
 * that warns "this will stay pending" for Yape/Transferencia/Plin would be
 * describing a state this endpoint can never produce — don't reintroduce
 * it; see CustomerPaymentSection's tests for the rule this protects.
 *
 * `amount`, `debtBalance` and `PaymentTotals.amount` are 2-decimal strings on
 * the wire, same as everywhere else: never through `Number`/`parseFloat`,
 * shown as-is via lib/money.ts.
 */
import type { ApiClient } from "./api-client";

/** Enum PaymentStatus en Prisma. */
export type PaymentStatus = "PENDING" | "CONFIRMED" | "REJECTED";

/** PaymentRowDto, trimmed to what this form's response needs. */
export interface Payment {
  id: string;
  status: PaymentStatus;
}

export interface CreateOfficePaymentBody {
  customerId: string;
  paymentMethodId: string;
  amount: string;
  /** UUID v4: a network retry of this exact call must reuse the same one. */
  idempotencyKey: string;
}

/** CreateOfficePaymentResponseDto. */
export interface CreateOfficePaymentResult {
  payment: Payment;
  debtBalance: string;
  exceedsDebt: boolean;
}

export function createOfficePayment(
  apiClient: ApiClient,
  body: CreateOfficePaymentBody,
): Promise<CreateOfficePaymentResult> {
  return apiClient.request<CreateOfficePaymentResult>("/payments", { method: "POST", body });
}

interface PaymentCustomerRef {
  id: string;
  name: string;
}

interface PaymentLocationRef {
  id: string;
  name: string;
}

interface PaymentMethodRef {
  id: string;
  name: string;
}

interface PaymentUserRef {
  id: string;
  username: string;
}

/** PaymentRowDto: the full row, for the confirmation tray (unlike the trimmed `Payment` above). */
export interface PaymentRow {
  id: string;
  customer: PaymentCustomerRef;
  location: PaymentLocationRef | null;
  paymentMethod: PaymentMethodRef;
  amount: string;
  status: PaymentStatus;
  paidAt: string;
  saleId: string | null;
  stopId: string | null;
  recordedBy: PaymentUserRef;
  confirmedAt: string | null;
  confirmedBy: PaymentUserRef | null;
  rejectedAt: string | null;
  rejectedBy: PaymentUserRef | null;
  rejectionReason: string | null;
  isOpeningBalance: boolean;
}

/** PaymentTotalsDto: sums the FULL filtered set, never just the page on screen. */
export interface PaymentTotals {
  count: number;
  amount: string;
}

/** PaginatedPaymentsDto. */
export interface PaginatedPayments {
  data: PaymentRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  totals: PaymentTotals;
}

/** ListPaymentsQueryDto. `paidFrom`/`paidTo` are instants (ISO-8601), not business dates. */
export interface ListPaymentsParams {
  page?: number;
  limit?: number;
  status?: PaymentStatus;
  paymentMethodId?: string;
  customerId?: string;
  paidFrom?: string;
  paidTo?: string;
  includeOpeningBalance?: boolean;
}

/** PaymentActionResponseDto: the updated row plus where the customer's debt landed. */
export interface PaymentActionResult {
  payment: PaymentRow;
  debtBalance: string;
}

/** Matches DEFAULT_LIMIT in the API's list-customers-query.dto.ts (reused by payments). */
export const PAYMENTS_PAGE_SIZE = 20;

function buildListQuery(params: ListPaymentsParams): string {
  const query = new URLSearchParams();
  if (params.page !== undefined) query.set("page", String(params.page));
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.status !== undefined) query.set("status", params.status);
  if (params.paymentMethodId) query.set("paymentMethodId", params.paymentMethodId);
  if (params.customerId) query.set("customerId", params.customerId);
  if (params.paidFrom) query.set("paidFrom", params.paidFrom);
  if (params.paidTo) query.set("paidTo", params.paidTo);
  if (params.includeOpeningBalance === true) query.set("includeOpeningBalance", "true");
  return query.toString();
}

export function listPayments(
  apiClient: ApiClient,
  params: ListPaymentsParams = {},
): Promise<PaginatedPayments> {
  const query = buildListQuery(params);
  return apiClient.request<PaginatedPayments>(`/payments${query ? `?${query}` : ""}`);
}

export function confirmPayment(apiClient: ApiClient, id: string): Promise<PaymentActionResult> {
  return apiClient.request<PaymentActionResult>(`/payments/${id}/confirm`, { method: "POST" });
}

export function rejectPayment(
  apiClient: ApiClient,
  id: string,
  body: { reason: string },
): Promise<PaymentActionResult> {
  return apiClient.request<PaymentActionResult>(`/payments/${id}/reject`, {
    method: "POST",
    body,
  });
}
