/**
 * Contracts derived from apps/api/src/modules/customer-locations. Do not
 * invent fields here: if the API changes, this file is updated against the
 * real DTOs.
 */
import type { ApiClient } from "./api-client";

/** CustomerLocationResponseDto. */
export interface CustomerLocation {
  id: string;
  name: string;
  address: string;
  addressReference: string;
  phone: string;
  isPrimary: boolean;
  active: boolean;
}

/**
 * Unpaginated: a customer has a handful of locations at most. No params
 * sent — `active` defaults to true server-side, the same "never offer
 * withdrawn" guarantee as listProducts/listContainerTypes.
 */
export function listCustomerLocations(
  apiClient: ApiClient,
  customerId: string,
): Promise<CustomerLocation[]> {
  return apiClient.request<CustomerLocation[]>(`/customers/${customerId}/locations`);
}
