import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service.js";
import type {
  ContainerBalanceRowDto,
  LocationContainerBalanceDto,
  PaginatedContainerBalancesDto,
} from "./dto/container-balance-response.dto.js";
import type { ListContainerBalancesQueryDto } from "./dto/list-container-balances-query.dto.js";

/** Everything the row needs, and nothing else. */
const LOCATION_INCLUDE = {
  customer: {
    select: { id: true, name: true, active: true, zone: { select: { id: true, name: true } } },
  },
  balances: {
    select: {
      containerTypeId: true,
      quantity: true,
      containerType: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.CustomerLocationInclude;

type LocationWithBalances = Prisma.CustomerLocationGetPayload<{ include: typeof LOCATION_INCLUDE }>;

/**
 * Each filter is a way the owner slices the audit work list:
 *   - zoneId: audit by zone, which is how routes are organized.
 *   - uncountedOnly: locations no one has counted yet — the ones the system
 *     knows nothing about, and therefore the first stop of the audit.
 *   - countedBefore: locations counted at some point, but whose most recent
 *     count is older than the instant given — re-audit what has gone stale.
 *     Never-counted locations are `uncountedOnly`'s job, not this one's.
 *   - withDiscrepancies: locations with some type in NEGATIVE balance. A
 *     negative balance means a delivery nobody recorded (the customer
 *     returned more than the books said they had). Since PR #51 it is a
 *     valid, storable value; this filter is what turns it from a stored
 *     fact into a visit.
 */
function buildLocationFilter(
  query: ListContainerBalancesQueryDto,
): Prisma.CustomerLocationWhereInput {
  const conditions: Prisma.CustomerLocationWhereInput[] = [];
  if (query.zoneId !== undefined) {
    conditions.push({ customer: { zoneId: query.zoneId } });
  }
  if (query.uncountedOnly === true) {
    conditions.push({ counts: { none: {} } });
  }
  if (query.countedBefore !== undefined) {
    const before = new Date(query.countedBefore);
    conditions.push({ counts: { some: {} } }, { counts: { none: { countedAt: { gte: before } } } });
  }
  if (query.withDiscrepancies === true) {
    conditions.push({ balances: { some: { quantity: { lt: 0 } } } });
  }
  return conditions.length === 0 ? {} : { AND: conditions };
}

/**
 * NOT a reuse of ContainerReconciliationService, and it must stay separate:
 * that routine answers "do the ledger and the materialized balance agree?"
 * — a consistency check over the books. This one answers "what does the
 * system believe each customer holds, and when was it last verified?" — a
 * work list for a human. Different question, different query, different
 * reader; fusing them would give the owner a diagnostic they cannot act on
 * and the reconciliation a shape it does not need.
 */
@Injectable()
export class ContainerBalancesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The query starts from customer_locations, NOT from
   * customer_container_balances. The balances table only has rows where a
   * movement ever happened: today it is almost empty, and the customers with
   * no row are precisely the ones the audit has to visit — the system knows
   * nothing about them. A query that started from the balances would
   * silently drop from the work list exactly the people who need it most.
   * So: every location appears, LEFT-joined to its balances and to its
   * counts; one with nothing on either side comes back with an empty
   * `containers` and a null `lastCountedAt`, which is the finding.
   *
   * Sorted by customer name (then location name): the order the owner
   * walks the list in.
   */
  async findAll(query: ListContainerBalancesQueryDto): Promise<PaginatedContainerBalancesDto> {
    const { page, limit } = query;
    const where = buildLocationFilter(query);

    const [total, locations] = await this.prisma.$transaction([
      this.prisma.customerLocation.count({ where }),
      this.prisma.customerLocation.findMany({
        where,
        orderBy: [{ customer: { name: "asc" } }, { name: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
        include: LOCATION_INCLUDE,
      }),
    ]);

    // Latest count per (location, type) for this page only — counts are
    // append-only and accumulate, so they are aggregated, never listed.
    const latestCounts = await this.prisma.containerCount.groupBy({
      by: ["locationId", "containerTypeId"],
      where: { locationId: { in: locations.map((location) => location.id) } },
      _max: { countedAt: true },
    });
    const countedTypeIds = [...new Set(latestCounts.map((count) => count.containerTypeId))];
    const containerTypes = await this.prisma.containerType.findMany({
      where: { id: { in: countedTypeIds } },
      select: { id: true, name: true },
    });
    const containerTypeById = new Map(containerTypes.map((type) => [type.id, type] as const));

    const data = locations.map((location) => {
      const lastCountByType = new Map<string, Date>();
      for (const count of latestCounts) {
        if (count.locationId === location.id && count._max.countedAt !== null) {
          lastCountByType.set(count.containerTypeId, count._max.countedAt);
        }
      }
      return toRow(location, lastCountByType, containerTypeById);
    });

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}

/**
 * `containers` carries only the types with a non-zero balance or at least
 * one count on record: a type this location never had anything of adds
 * nothing to the audit.
 */
function toRow(
  location: LocationWithBalances,
  lastCountByType: Map<string, Date>,
  containerTypeById: Map<string, { id: string; name: string }>,
): ContainerBalanceRowDto {
  const containers = new Map<string, LocationContainerBalanceDto>();
  for (const balance of location.balances) {
    if (balance.quantity !== 0 || lastCountByType.has(balance.containerTypeId)) {
      containers.set(balance.containerTypeId, {
        containerType: balance.containerType,
        quantity: balance.quantity,
        lastCountedAt: lastCountByType.get(balance.containerTypeId) ?? null,
      });
    }
  }
  for (const [containerTypeId, lastCountedAt] of lastCountByType) {
    if (!containers.has(containerTypeId)) {
      containers.set(containerTypeId, {
        containerType: containerTypeById.get(containerTypeId) ?? { id: containerTypeId, name: "" },
        quantity: 0,
        lastCountedAt,
      });
    }
  }
  const rows = [...containers.values()].sort((a, b) =>
    a.containerType.name.localeCompare(b.containerType.name),
  );

  let lastCountedAt: Date | null = null;
  for (const date of lastCountByType.values()) {
    if (lastCountedAt === null || date > lastCountedAt) lastCountedAt = date;
  }

  return {
    customer: {
      id: location.customer.id,
      name: location.customer.name,
      active: location.customer.active,
    },
    location: { id: location.id, name: location.name, active: location.active },
    zone: location.customer.zone,
    totalQuantity: rows.reduce((sum, row) => sum + row.quantity, 0),
    lastCountedAt,
    containers: rows,
  };
}
