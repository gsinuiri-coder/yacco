import { Injectable } from "@nestjs/common";
import { ContainerMovementType, ContainerState, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service.js";
import { ContainerMovementsService } from "../container-movements/container-movements.service.js";
import {
  assertContainerTypeExists,
  assertLocationExists,
} from "../container-movements/container-reference-guards.js";
import type { CreateContainerCountDto } from "./dto/create-container-count.dto.js";
import type { ContainerCountResponseDto } from "./dto/container-count-response.dto.js";

/** Everything the wire shape needs, and nothing else. */
const COUNT_INCLUDE = {
  location: { select: { id: true, name: true } },
  containerType: { select: { id: true, name: true } },
} satisfies Prisma.ContainerCountInclude;

type CountWithRelations = Prisma.ContainerCountGetPayload<{ include: typeof COUNT_INCLUDE }>;

function toCountResponse(count: CountWithRelations): ContainerCountResponseDto {
  return {
    id: count.id,
    locationId: count.locationId,
    location: count.location,
    containerTypeId: count.containerTypeId,
    containerType: count.containerType,
    countedAt: count.countedAt,
    countedQuantity: count.countedQuantity,
    expectedQuantity: count.expectedQuantity,
    adjustmentId: count.adjustmentId,
    countedById: count.countedById,
  };
}

@Injectable()
export class ContainerCountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly containerMovementsService: ContainerMovementsService,
  ) {}

  /**
   * Registers one physical count — append-only, same rule as
   * ContainerMovement: there is deliberately no update()/remove() here or on
   * the controller. A single write method, in a single transaction:
   *
   * 1. Reads CustomerContainerBalance (0 if the pair has no row yet) as
   *    `expectedQuantity` — what the system believed a moment before this
   *    count.
   * 2. `delta = countedQuantity - expectedQuantity`. A positive delta means
   *    the customer has more than the books say (COUNT_ADJUSTMENT from
   *    outside the fleet into WITH_CUSTOMER); negative means fewer
   *    (WITH_CUSTOMER out). `expectedQuantity` may be negative (a return
   *    larger than the books said — a delivery nobody recorded), so a
   *    count of 0 yields a positive delta larger than what was counted:
   *    that adjustment is the unrecorded delivery finally entering the
   *    ledger. Zero means the count matched — the ledger's own
   *    CHECK requires a positive quantity, and a zero-quantity entry
   *    wouldn't say anything a movement can say anyway, so none is emitted.
   *    The count row is still written either way: a count that matches is
   *    proof of match, not a non-event.
   * 3. The movement, when there is one, is emitted through
   *    `ContainerMovementsService.createWithinTransaction` with this same
   *    transaction's client, so the ledger row and this count row commit or
   *    roll back together.
   *
   * `options.occurredAt` is not on `CreateContainerCountDto` for the same
   * reason `occurredAt`/`batchId` are not on `CreateContainerMovementDto`:
   * it is internal linkage only a trusted caller may set — here, the
   * customer-roster loader backdating a count taken before the system
   * existed. It becomes both this row's `countedAt` and the emitted
   * movement's `occurredAt`, so the ledger and this count agree on when it
   * happened. Defaults to now otherwise.
   *
   * `countedAt` is NOT reconstructible from container_movements: a matched
   * count (delta === 0) leaves no ledger trace at all, so the verification
   * date lives only here. The reconciliation routine (next PR) compares
   * quantities against the ledger, never dates, for exactly this reason.
   */
  async create(
    dto: CreateContainerCountDto,
    countedById: string,
    options?: { occurredAt?: Date },
  ): Promise<ContainerCountResponseDto> {
    const countedAt = options?.occurredAt ?? new Date();

    const created = await this.prisma.$transaction(async (tx) => {
      await assertContainerTypeExists(tx, dto.containerTypeId);
      await assertLocationExists(tx, dto.locationId);

      const balance = await tx.customerContainerBalance.findUnique({
        where: {
          locationId_containerTypeId: {
            locationId: dto.locationId,
            containerTypeId: dto.containerTypeId,
          },
        },
      });
      const expectedQuantity = balance?.quantity ?? 0;
      const delta = dto.countedQuantity - expectedQuantity;

      let adjustmentId: string | null = null;
      if (delta !== 0) {
        const movement = await this.containerMovementsService.createWithinTransaction(
          tx,
          {
            type: ContainerMovementType.COUNT_ADJUSTMENT,
            containerTypeId: dto.containerTypeId,
            quantity: Math.abs(delta),
            locationId: dto.locationId,
            ...(delta > 0
              ? { toState: ContainerState.WITH_CUSTOMER }
              : { fromState: ContainerState.WITH_CUSTOMER }),
          },
          countedById,
          { occurredAt: countedAt },
        );
        adjustmentId = movement.id;
      }

      return tx.containerCount.create({
        data: {
          locationId: dto.locationId,
          containerTypeId: dto.containerTypeId,
          countedAt,
          countedQuantity: dto.countedQuantity,
          expectedQuantity,
          adjustmentId,
          countedById,
        },
        include: COUNT_INCLUDE,
      });
    });

    return toCountResponse(created);
  }
}
