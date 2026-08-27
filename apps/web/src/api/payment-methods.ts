/**
 * Contracts derived from apps/api/src/modules/payment-methods. Do not invent
 * fields here: if the API changes, this file is updated against the real
 * DTOs.
 */
import type { ApiClient } from "./api-client";

/** PaymentMethodResponseDto. */
export interface PaymentMethod {
  id: string;
  name: string;
  active: boolean;
  requiresConfirmation: boolean;
}

/**
 * Unpaginated: a handful of seeded rows. No params sent — `active` defaults
 * to true server-side (PaymentMethodsService.findAll), so a withdrawn method
 * — including the synthetic "Apertura" the roster loader upserts, born
 * inactive on purpose — never shows up in this list.
 */
export function listPaymentMethods(apiClient: ApiClient): Promise<PaymentMethod[]> {
  return apiClient.request<PaymentMethod[]>("/payment-methods");
}
