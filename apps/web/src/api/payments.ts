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
