/**
 * Contracts derived from apps/api/src/modules/customer-prices. Do not invent
 * fields here: if the API changes, this file is updated against the real
 * DTOs. Money (`price`) is a 2-decimal string on the wire and stays a string
 * here — see lib/money.ts.
 *
 * `locationId` is deliberately absent from the write shapes below: the API
 * accepts an optional one, but there is no endpoint to list a customer's
 * locations, so offering that field would ask for a UUID nobody can know —
 * the same mistake the Zona field was for customers (see
 * docs/backlog-tecnico.md). This screen manages customer-wide prices only.
 */
import type { ApiClient } from "./api-client";

/** CustomerPriceProductDto / CustomerPriceLocationDto: the minimum to show a name. */
export interface CustomerPriceProduct {
  id: string;
  name: string;
}

export interface CustomerPriceLocation {
  id: string;
  name: string;
}

/** CustomerPriceResponseDto. `location` is null for a customer-wide price. */
export interface CustomerPrice {
  id: string;
  product: CustomerPriceProduct;
  location: CustomerPriceLocation | null;
  price: string;
}

/** CreateCustomerPriceDto, minus `locationId` — see the file note above. */
export interface CreateCustomerPriceBody {
  productId: string;
  price: string;
}

/** UpdateCustomerPriceDto: only the price can change. */
export interface UpdateCustomerPriceBody {
  price: string;
}

/** EffectivePriceResponseDto's `source`: where the resolved price came from. */
export type PriceSource = "LOCATION" | "CUSTOMER" | "LIST";

/** EffectivePriceResponseDto. */
export interface EffectivePrice {
  product: CustomerPriceProduct;
  price: string;
  source: PriceSource;
}

/** ADMIN-only management list — every agreed price for this customer. */
export function listCustomerPrices(
  apiClient: ApiClient,
  customerId: string,
): Promise<CustomerPrice[]> {
  return apiClient.request<CustomerPrice[]>(`/customers/${customerId}/prices`);
}

export function createCustomerPrice(
  apiClient: ApiClient,
  customerId: string,
  body: CreateCustomerPriceBody,
): Promise<CustomerPrice> {
  return apiClient.request<CustomerPrice>(`/customers/${customerId}/prices`, {
    method: "POST",
    body,
  });
}

export function updateCustomerPrice(
  apiClient: ApiClient,
  customerId: string,
  priceId: string,
  body: UpdateCustomerPriceBody,
): Promise<CustomerPrice> {
  return apiClient.request<CustomerPrice>(`/customers/${customerId}/prices/${priceId}`, {
    method: "PATCH",
    body,
  });
}

export function deleteCustomerPrice(
  apiClient: ApiClient,
  customerId: string,
  priceId: string,
): Promise<void> {
  return apiClient.request<void>(`/customers/${customerId}/prices/${priceId}`, {
    method: "DELETE",
  });
}

/**
 * ADMIN and SELLER: the price actually in effect for every active product
 * today, and where it came from. Open to a wider audience than the
 * management list above, so this is what a non-ADMIN viewer of the customer's
 * prices reads — read-only, by construction (there is no agreement id to
 * act on for a LIST-sourced entry).
 */
export function listEffectivePrices(
  apiClient: ApiClient,
  customerId: string,
): Promise<EffectivePrice[]> {
  return apiClient.request<EffectivePrice[]>(`/customers/${customerId}/effective-prices`);
}
