/**
 * Contracts derived from apps/api/src/modules/customers. Do not invent fields
 * here: if the API changes, this file is updated against the real DTOs.
 *
 * Money (`creditLimit`, `debtBalance`) is a 2-decimal string on the wire and
 * stays a string here. `debtBalance` is read-only — the API rejects a body
 * carrying it — so it appears in Customer but in neither write shape.
 */
import type { ApiClient } from "./api-client";

/** CustomerResponseDto. `createdAt` is an ISO instant once serialized. */
export interface Customer {
  id: string;
  name: string;
  phone: string;
  address: string;
  addressReference: string;
  zoneId: string | null;
  creditLimit: string | null;
  debtBalance: string;
  active: boolean;
  createdAt: string;
}

/** PaginatedCustomersDto. */
export interface PaginatedCustomers {
  data: Customer[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** ListCustomersQueryDto. */
export interface CustomerListParams {
  page?: number;
  limit?: number;
  search?: string;
  zoneId?: string;
  active?: boolean;
}

/** CreateCustomerDto, minus `active` (a new customer is active by default). */
export interface CreateCustomerBody {
  name: string;
  phone: string;
  address: string;
  addressReference: string;
  zoneId?: string;
  creditLimit?: string;
}

/** UpdateCustomerDto: every field optional, plus the deactivation flag. */
export interface UpdateCustomerBody extends Partial<CreateCustomerBody> {
  active?: boolean;
}

/** Matches MAX_LIMIT in the API's list-customers-query.dto.ts. */
export const CUSTOMERS_PAGE_SIZE = 20;

/**
 * Empty values are omitted rather than sent blank: `zoneId=""` would fail the
 * API's @IsUUID and turn a cleared filter into a 400.
 */
function buildListQuery(params: CustomerListParams): string {
  const query = new URLSearchParams();
  if (params.page !== undefined) query.set("page", String(params.page));
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.search) query.set("search", params.search);
  if (params.zoneId) query.set("zoneId", params.zoneId);
  if (params.active !== undefined) query.set("active", String(params.active));
  return query.toString();
}

export function listCustomers(
  apiClient: ApiClient,
  params: CustomerListParams = {},
): Promise<PaginatedCustomers> {
  const query = buildListQuery(params);
  return apiClient.request<PaginatedCustomers>(`/customers${query ? `?${query}` : ""}`);
}

export function getCustomer(apiClient: ApiClient, id: string): Promise<Customer> {
  return apiClient.request<Customer>(`/customers/${id}`);
}

export function createCustomer(apiClient: ApiClient, body: CreateCustomerBody): Promise<Customer> {
  return apiClient.request<Customer>("/customers", { method: "POST", body });
}

export function updateCustomer(
  apiClient: ApiClient,
  id: string,
  body: UpdateCustomerBody,
): Promise<Customer> {
  return apiClient.request<Customer>(`/customers/${id}`, { method: "PATCH", body });
}
