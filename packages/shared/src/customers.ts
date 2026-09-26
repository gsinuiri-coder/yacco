/**
 * Contracts derived from apps/api/src/modules/customers. Nothing invented:
 * when the API changes, this file changes against the real DTOs.
 *
 * Money (`creditLimit`, `debtBalance`) is a 2-decimal string on the wire.
 * `debtBalance` is read-only — the API rejects a body carrying it — so it is
 * on Customer and on neither write shape.
 */

/** CustomerResponseDto. `createdAt` is an ISO instant. */
export interface Customer {
  id: string;
  name: string;
  phone: string;
  address: string;
  addressReference: string;
  zoneId: string | null;
  zone: { id: string; name: string } | null;
  creditLimit: string | null;
  debtBalance: string;
  active: boolean;
  createdAt: string;
}

/** ListCustomersQueryDto. */
export interface CustomerListQuery {
  page?: number;
  limit?: number;
  search?: string;
  zoneId?: string;
  /** Only customers without a zone ("Sin zona"). Mutually exclusive with `zoneId`: both is a 400. */
  withoutZone?: boolean;
  active?: boolean;
}

/** CreateCustomerDto, without `active`: a new customer starts active. */
export interface CreateCustomerBody {
  name: string;
  phone: string;
  address: string;
  addressReference: string;
  zoneId?: string;
  creditLimit?: string;
}

/** UpdateCustomerDto: every field optional, plus deactivation. */
export interface UpdateCustomerBody extends Partial<CreateCustomerBody> {
  active?: boolean;
}

/** MAX_LIMIT in the API's list-customers-query.dto.ts. */
export const CUSTOMERS_PAGE_SIZE = 20;

/**
 * ZoneCustomerCountsDto (GET /customers/zone-counts). Active customers only;
 * a zone with none is absent from `zones`, so a missing zone reads as 0.
 */
export interface ZoneCustomerCounts {
  zones: Array<{ zoneId: string; activeCustomers: number }>;
  withoutZone: number;
}
