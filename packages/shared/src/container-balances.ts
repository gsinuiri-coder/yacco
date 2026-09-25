/**
 * Contracts derived from apps/api/src/modules/container-balances. The report
 * deliberately includes deactivated customers and locations — a customer
 * taken off the books while still holding containers is the most urgent
 * case — and `active` is how the screen tells them apart.
 */

export interface NamedReference {
  id: string;
  name: string;
}

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

/**
 * ListContainerBalancesQueryDto. `countedBefore` is an ISO-8601 instant, not
 * a business date. `zoneId` comes from the zones catalog (GET /zones).
 */
export interface ContainerBalanceListQuery {
  page?: number;
  limit?: number;
  zoneId?: string;
  /** Every location of one customer (their page's containers section). */
  customerId?: string;
  search?: string;
  uncountedOnly?: boolean;
  countedBefore?: string;
  withDiscrepancies?: boolean;
}

/** Matches DEFAULT_LIMIT in the API's list-customers-query.dto.ts, which the report reuses. */
export const CONTAINER_BALANCES_PAGE_SIZE = 20;
