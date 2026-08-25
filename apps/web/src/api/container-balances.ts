/**
 * Contracts derived from apps/api/src/modules/container-balances. Do not
 * invent fields here: if the API changes, this file is updated against the
 * real DTOs.
 */
import type { ApiClient } from "./api-client";

/** NamedReferenceDto. */
export interface NamedReference {
  id: string;
  name: string;
}

/**
 * ActiveNamedReferenceDto. The report deliberately includes deactivated
 * customers and locations — a customer taken off the books while still
 * holding containers is the most urgent case — and `active` is how the
 * screen tells them apart.
 */
export interface ActiveNamedReference extends NamedReference {
  active: boolean;
}

/** LocationContainerBalanceDto. `quantity` may be negative: an unrecorded delivery. */
export interface LocationContainerBalance {
  containerType: NamedReference;
  quantity: number;
  lastCountedAt: string | null;
}

/** ContainerBalanceRowDto: one row per customer LOCATION. */
export interface ContainerBalanceRow {
  customer: ActiveNamedReference;
  location: ActiveNamedReference;
  zone: NamedReference | null;
  totalQuantity: number;
  lastCountedAt: string | null;
  containers: LocationContainerBalance[];
}

/** PaginatedContainerBalancesDto. */
export interface PaginatedContainerBalances {
  data: ContainerBalanceRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * ListContainerBalancesQueryDto. `countedBefore` is an ISO-8601 instant,
 * not a business date. `zoneId` exists server-side but the web has no zones
 * catalog endpoint to offer it from, so it is not exposed here.
 */
export interface ContainerBalanceListParams {
  page?: number;
  limit?: number;
  uncountedOnly?: boolean;
  countedBefore?: string;
  withDiscrepancies?: boolean;
}

/** Matches DEFAULT_LIMIT in the API's list-customers-query.dto.ts, which the report reuses. */
export const CONTAINER_BALANCES_PAGE_SIZE = 20;

function buildListQuery(params: ContainerBalanceListParams): string {
  const query = new URLSearchParams();
  if (params.page !== undefined) query.set("page", String(params.page));
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.uncountedOnly) query.set("uncountedOnly", "true");
  if (params.countedBefore) query.set("countedBefore", params.countedBefore);
  if (params.withDiscrepancies) query.set("withDiscrepancies", "true");
  return query.toString();
}

export function listContainerBalances(
  apiClient: ApiClient,
  params: ContainerBalanceListParams = {},
): Promise<PaginatedContainerBalances> {
  const query = buildListQuery(params);
  return apiClient.request<PaginatedContainerBalances>(
    `/container-balances${query ? `?${query}` : ""}`,
  );
}
