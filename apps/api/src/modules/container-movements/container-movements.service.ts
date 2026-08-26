import { BadRequestException, Injectable } from "@nestjs/common";
import { ContainerMovementType, ContainerState, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service.js";
import { isValidContainerTransition } from "./container-movement-transitions.js";
import {
  assertContainerTypeDeliverable,
  assertContainerTypeExists,
  assertLocationExists,
} from "./container-reference-guards.js";
import type { CreateContainerMovementDto } from "./dto/create-container-movement.dto.js";
import type {
  ContainerInventoryItemDto,
  ContainerMovementResponseDto,
  PaginatedContainerMovementsDto,
} from "./dto/container-movement-response.dto.js";
import type { ListContainerMovementsQueryDto } from "./dto/list-container-movements-query.dto.js";

/** Everything the wire shape needs, and nothing else. */
const MOVEMENT_INCLUDE = {
  containerType: { select: { id: true, name: true } },
  location: { select: { id: true, name: true } },
} satisfies Prisma.ContainerMovementInclude;

type MovementWithRelations = Prisma.ContainerMovementGetPayload<{
  include: typeof MOVEMENT_INCLUDE;
}>;

function toMovementResponse(movement: MovementWithRelations): ContainerMovementResponseDto {
  return {
    id: movement.id,
    occurredAt: movement.occurredAt,
    type: movement.type,
    containerTypeId: movement.containerTypeId,
    containerType: movement.containerType,
    quantity: movement.quantity,
    fromState: movement.fromState,
    toState: movement.toState,
    locationId: movement.locationId,
    location: movement.location,
    recordedById: movement.recordedById,
  };
}

/**
 * Lima has no DST and sits at UTC-5, so its midnight is always 05:00 UTC.
 * `occurredAt` is a timestamptz; a "from/to" filter on it is a business day
 * (CLAUDE.md), so both ends are converted to their UTC instant boundary here
 * rather than compared as naive dates.
 */
function limaDayStartUtc(date: string): Date {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day, 5, 0, 0));
}

/**
 * Movement types that only ever enter through their own trusted writer, each
 * calling `createWithinTransaction` directly — never through this public
 * route. Each writer keeps a companion record this ledger row must stay in
 * lock-step with: the customer-roster loader's cutover entry for
 * OPENING_BALANCE, the `container_counts` row for COUNT_ADJUSTMENT. A
 * movement of either type registered here by hand would have no such
 * companion, leaving the ledger and that record diverging — exactly what
 * each of those tables exists to prevent.
 */
const INTERNAL_ONLY_MOVEMENT_TYPES: ReadonlySet<ContainerMovementType> = new Set([
  ContainerMovementType.OPENING_BALANCE,
  ContainerMovementType.COUNT_ADJUSTMENT,
]);

@Injectable()
export class ContainerMovementsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registers one ledger row — append-only, never updated or deleted (spec):
   * a mistake is corrected with an inverse movement, never by editing this
   * one. There is deliberately no update()/remove() on this service or its
   * controller. Opens its own transaction; the HTTP controller is the only
   * caller that needs one (a caller with an already-open transaction of its
   * own — ProductionBatchesService — uses `createWithinTransaction` below).
   */
  async create(
    dto: CreateContainerMovementDto,
    recordedById: string,
  ): Promise<ContainerMovementResponseDto> {
    if (INTERNAL_ONLY_MOVEMENT_TYPES.has(dto.type)) {
      throw new BadRequestException("Este tipo de movimiento no se registra por esta vía");
    }
    const movement = await this.prisma.$transaction((tx) =>
      this.createWithinTransaction(tx, dto, recordedById),
    );
    return toMovementResponse(movement);
  }

  /**
   * The one place the ledger is ever written — everything above validates,
   * this is the only INSERT. Takes a Prisma client rather than assuming
   * `this.prisma`: `create()` above passes its own freshly-opened `tx`, and a
   * caller that already has an open transaction (a production batch's
   * FILLING movements) passes that one instead, so the movement and
   * whatever else that caller is doing commit or roll back together — never
   * two separate transactions pretending to be one.
   *
   * `type` alone no longer determines fromState/toState (damage happens at
   * the plant and on the route; a sale can leave from either), so the caller
   * states both explicitly and this validates the pair against
   * `CONTAINER_MOVEMENT_TRANSITIONS` — the one place that rule lives.
   *
   * A movement touching "with the customer" on either side updates
   * `CustomerContainerBalance` in the SAME transaction: letting the ledger
   * and the balance diverge would make the system lie about what a customer
   * still owes in containers.
   *
   * `batchId`, `routeId` and `occurredAt` are deliberately not part of
   * `CreateContainerMovementDto`: all three are internal linkage only a
   * trusted caller with an already-open transaction may set — `batchId` by a
   * production batch registering its FILLING movements, `routeId` by
   * RoutesService registering a ROUTE_LOAD (or its FULL_RETURN reversal),
   * `occurredAt` by the customer-roster loader backdating an OPENING_BALANCE
   * entry to the roster's cutover date. None of the three is something a
   * caller of the public POST /container-movements route should be able to
   * fabricate by hand.
   */
  async createWithinTransaction(
    client: Prisma.TransactionClient,
    dto: CreateContainerMovementDto,
    recordedById: string,
    options?: { batchId?: string; routeId?: string; occurredAt?: Date },
  ): Promise<MovementWithRelations> {
    const fromState = dto.fromState ?? null;
    const toState = dto.toState ?? null;

    if (!isValidContainerTransition(dto.type, fromState, toState)) {
      throw new BadRequestException(
        `El movimiento "${dto.type}" no admite pasar de ${fromState ?? "fuera de la empresa"} a ${toState ?? "fuera de la empresa"}`,
      );
    }

    // occurredAt is an instant (timestamptz), not a business date — the
    // caller is responsible for resolving its own calendar date to an
    // instant before it gets here; this service does no timezone conversion.
    // Defaults to now for every caller except the one that backdates it.
    const occurredAt = options?.occurredAt ?? new Date();
    if (occurredAt.getTime() > Date.now()) {
      throw new BadRequestException("La fecha del movimiento no puede ser futura");
    }

    const containerType = await assertContainerTypeExists(client, dto.containerTypeId);
    // A withdrawn type may still come back from customers, never go out to
    // them again — see assertContainerTypeDeliverable for the whole rule.
    assertContainerTypeDeliverable(containerType, fromState, toState);

    const touchesCustomer =
      fromState === ContainerState.WITH_CUSTOMER || toState === ContainerState.WITH_CUSTOMER;
    if (touchesCustomer && dto.locationId === undefined) {
      throw new BadRequestException('Un movimiento hacia o desde "en cliente" exige una locación');
    }
    if (dto.locationId !== undefined) {
      await assertLocationExists(client, dto.locationId);
    }

    const created = await client.containerMovement.create({
      data: {
        occurredAt,
        type: dto.type,
        containerTypeId: dto.containerTypeId,
        quantity: dto.quantity,
        fromState,
        toState,
        locationId: dto.locationId ?? null,
        batchId: options?.batchId ?? null,
        routeId: options?.routeId ?? null,
        recordedById,
      },
      include: MOVEMENT_INCLUDE,
    });

    if (touchesCustomer) {
      // Never both at once: no type in the matrix has WITH_CUSTOMER on
      // both sides, so this is a plain delivery-in or pickup/write-off-out.
      const delta = toState === ContainerState.WITH_CUSTOMER ? dto.quantity : -dto.quantity;
      // dto.locationId is defined here — touchesCustomer already required it above.
      const locationId = dto.locationId as string;
      const key = {
        locationId_containerTypeId: { locationId, containerTypeId: dto.containerTypeId },
      };
      // Reads the current balance and writes the absolute result inside
      // this same transaction, rather than upsert's `increment`: with a
      // composite (no single-column) id, Prisma's upsert does not apply
      // `increment` against the row already on disk when the ON CONFLICT
      // branch is taken, so a second movement silently overwrote the first
      // instead of adding to it.
      // A negative result is valid and expected, never clamped or rejected:
      // this balance is what the system BELIEVES the customer holds, and the
      // belief can be wrong. The previous driver forgot to write down a
      // delivery, the books say 2, the customer hands back 3 -> -1. That
      // sign says "there is a delivery nobody recorded" — information the
      // owner needs, which is why the database no longer has a CHECK on it
      // (20260824164243_allow_negative_container_balance). Blocking here
      // would only make the driver skip registering the return, losing both
      // facts. A physical count later brings it back to what is actually
      // there, through COUNT_ADJUSTMENT.
      const existing = await client.customerContainerBalance.findUnique({ where: key });
      const nextQuantity = (existing?.quantity ?? 0) + delta;
      await client.customerContainerBalance.upsert({
        where: key,
        create: { locationId, containerTypeId: dto.containerTypeId, quantity: nextQuantity },
        update: { quantity: nextQuantity },
      });
    }

    return created;
  }

  /** Always paginated; the count runs against the same filter as the page. */
  async findAll(query: ListContainerMovementsQueryDto): Promise<PaginatedContainerMovementsDto> {
    const { page, limit } = query;
    const where = buildMovementFilter(query);

    const [total, movements] = await this.prisma.$transaction([
      this.prisma.containerMovement.count({ where }),
      this.prisma.containerMovement.findMany({
        where,
        include: MOVEMENT_INCLUDE,
        orderBy: { occurredAt: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: movements.map(toMovementResponse),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Quantity by container type and by state, derived from the ledger itself
   * — never a separately maintained counter. For each state, the net
   * quantity is every movement that landed there minus every movement that
   * left it; a state a container type never touched reports 0, not an
   * absent row, so a caller can render a complete inventory without having
   * to know in advance which cells exist.
   */
  async inventory(): Promise<ContainerInventoryItemDto[]> {
    const [containerTypes, into, outOf] = await Promise.all([
      this.prisma.containerType.findMany({ orderBy: { name: "asc" } }),
      this.prisma.containerMovement.groupBy({
        by: ["containerTypeId", "toState"],
        where: { toState: { not: null } },
        _sum: { quantity: true },
      }),
      this.prisma.containerMovement.groupBy({
        by: ["containerTypeId", "fromState"],
        where: { fromState: { not: null } },
        _sum: { quantity: true },
      }),
    ]);

    const netByKey = new Map<string, number>();
    for (const row of into) {
      const key = `${row.containerTypeId}:${row.toState}`;
      netByKey.set(key, (netByKey.get(key) ?? 0) + (row._sum.quantity ?? 0));
    }
    for (const row of outOf) {
      const key = `${row.containerTypeId}:${row.fromState}`;
      netByKey.set(key, (netByKey.get(key) ?? 0) - (row._sum.quantity ?? 0));
    }

    const states = Object.values(ContainerState);
    return containerTypes.flatMap((containerType) =>
      states.map((state) => ({
        containerTypeId: containerType.id,
        containerType: { id: containerType.id, name: containerType.name },
        state,
        quantity: netByKey.get(`${containerType.id}:${state}`) ?? 0,
      })),
    );
  }
}

function buildMovementFilter(
  query: ListContainerMovementsQueryDto,
): Prisma.ContainerMovementWhereInput {
  const { type, containerTypeId, locationId, dateFrom, dateTo } = query;
  const from = dateFrom === undefined ? undefined : limaDayStartUtc(dateFrom);
  // "Hasta" is inclusive of the whole calendar day, so the upper bound is the
  // START of the FOLLOWING Lima day, compared with a strict `<`.
  const to =
    dateTo === undefined
      ? undefined
      : new Date(limaDayStartUtc(dateTo).getTime() + 24 * 60 * 60 * 1000);

  if (from !== undefined && to !== undefined && from >= to) {
    throw new BadRequestException("La fecha desde no puede ser posterior a la fecha hasta");
  }

  return {
    ...(type !== undefined ? { type } : {}),
    ...(containerTypeId !== undefined ? { containerTypeId } : {}),
    ...(locationId !== undefined ? { locationId } : {}),
    ...(from !== undefined || to !== undefined
      ? {
          occurredAt: {
            ...(from !== undefined ? { gte: from } : {}),
            ...(to !== undefined ? { lt: to } : {}),
          },
        }
      : {}),
  };
}
