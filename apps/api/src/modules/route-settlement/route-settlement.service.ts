import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import {
  ContainerMovementType,
  PaymentStatus,
  Prisma,
  RouteStatus,
  StopStatus,
} from "@prisma/client";
import type { RouteSettlement } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service.js";
import type { CreateRouteSettlementDto } from "./dto/create-route-settlement.dto.js";
import type {
  CreateRouteSettlementResponseDto,
  GetRouteSettlementResponseDto,
  RouteSettlementDto,
  RouteSettlementExpectedDto,
} from "./dto/route-settlement-response.dto.js";

interface Expected {
  fullOut: number;
  fullDelivered: number;
  fullSold: number;
  emptiesPickedUp: number;
  totalSold: Prisma.Decimal;
  totalCollected: Prisma.Decimal;
  totalCashCollected: Prisma.Decimal;
  totalPendingConfirmation: Prisma.Decimal;
  totalOnCredit: Prisma.Decimal;
}

function toExpectedDto(expected: Expected): RouteSettlementExpectedDto {
  return {
    fullOut: expected.fullOut,
    fullDelivered: expected.fullDelivered,
    fullSold: expected.fullSold,
    emptiesPickedUp: expected.emptiesPickedUp,
    totalSold: expected.totalSold.toFixed(2),
    totalCollected: expected.totalCollected.toFixed(2),
    totalCashCollected: expected.totalCashCollected.toFixed(2),
    totalPendingConfirmation: expected.totalPendingConfirmation.toFixed(2),
    totalOnCredit: expected.totalOnCredit.toFixed(2),
  };
}

function toSettlementDto(settlement: RouteSettlement): RouteSettlementDto {
  return {
    routeId: settlement.routeId,
    fullOut: settlement.fullOut,
    fullDelivered: settlement.fullDelivered,
    fullSold: settlement.fullSold,
    fullReturned: settlement.fullReturned,
    emptiesCollected: settlement.emptiesCollected,
    totalSold: settlement.totalSold.toFixed(2),
    totalCollected: settlement.totalCollected.toFixed(2),
    totalCashCollected: settlement.totalCashCollected.toFixed(2),
    totalPendingConfirmation: settlement.totalPendingConfirmation.toFixed(2),
    totalOnCredit: settlement.totalOnCredit.toFixed(2),
    notes: settlement.notes,
    settledById: settlement.settledById,
    settledAt: settlement.settledAt,
  };
}

@Injectable()
export class RouteSettlementService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Everything a settlement needs that comes straight from the ledger, no
   * physical count involved — shared by the GET preview and the POST that
   * persists it, so the two can never disagree about what the books say.
   * `totalCollected` sums CONFIRMED and PENDING alike (a REJECTED payment
   * never arrived, so it never counts); `totalCashCollected` narrows that to
   * CONFIRMED rows on a method with `requiresConfirmation: false` — see
   * docs/backlog-tecnico.md for why that's a proxy, not a real `isCash` flag.
   * Sale/Payment have no routeId column, only `stopId`, so both join through
   * `stop: { routeId }` — the same relation-filter idiom already used
   * elsewhere in this codebase (e.g. SalesService.assertNoOpeningBalanceExists,
   * which joins `location: { customerId }` for the same reason: Sale has no
   * customerId column of its own either).
   */
  private async computeExpected(
    client: Prisma.TransactionClient | PrismaService,
    routeId: string,
  ): Promise<Expected> {
    const [
      fullOutAgg,
      fullDeliveredAgg,
      fullSoldAgg,
      emptiesPickedUpAgg,
      totalSoldAgg,
      collectedAgg,
      cashAgg,
      pendingAgg,
    ] = await Promise.all([
      client.routeLoad.aggregate({ where: { routeId }, _sum: { quantity: true } }),
      client.containerMovement.aggregate({
        where: { routeId, type: ContainerMovementType.LOAN_DELIVERY },
        _sum: { quantity: true },
      }),
      client.containerMovement.aggregate({
        where: { routeId, type: ContainerMovementType.FULL_SALE },
        _sum: { quantity: true },
      }),
      client.containerMovement.aggregate({
        where: { routeId, type: ContainerMovementType.EMPTY_PICKUP },
        _sum: { quantity: true },
      }),
      client.sale.aggregate({ where: { stop: { routeId } }, _sum: { total: true } }),
      client.payment.aggregate({
        where: {
          stop: { routeId },
          status: { in: [PaymentStatus.CONFIRMED, PaymentStatus.PENDING] },
        },
        _sum: { amount: true },
      }),
      client.payment.aggregate({
        where: {
          stop: { routeId },
          status: PaymentStatus.CONFIRMED,
          paymentMethod: { requiresConfirmation: false },
        },
        _sum: { amount: true },
      }),
      client.payment.aggregate({
        where: { stop: { routeId }, status: PaymentStatus.PENDING },
        _sum: { amount: true },
      }),
    ]);

    const totalSold = totalSoldAgg._sum.total ?? new Prisma.Decimal(0);
    const totalCollected = collectedAgg._sum.amount ?? new Prisma.Decimal(0);

    return {
      fullOut: fullOutAgg._sum.quantity ?? 0,
      fullDelivered: fullDeliveredAgg._sum.quantity ?? 0,
      fullSold: fullSoldAgg._sum.quantity ?? 0,
      emptiesPickedUp: emptiesPickedUpAgg._sum.quantity ?? 0,
      totalSold,
      totalCollected,
      totalCashCollected: cashAgg._sum.amount ?? new Prisma.Decimal(0),
      totalPendingConfirmation: pendingAgg._sum.amount ?? new Prisma.Decimal(0),
      totalOnCredit: totalSold.minus(totalCollected),
    };
  }

  /**
   * Served whether the route is settled or not — this is the screen the
   * owner counts containers against at the door, so it has to work BEFORE
   * settling, not just after.
   */
  async getSettlementView(routeId: string): Promise<GetRouteSettlementResponseDto> {
    const route = await this.prisma.route.findUnique({
      where: { id: routeId },
      select: { id: true },
    });
    if (route === null) {
      throw new NotFoundException(`La ruta "${routeId}" no existe`);
    }

    const [expected, settlement, unresolvedStops] = await Promise.all([
      this.computeExpected(this.prisma, routeId),
      this.prisma.routeSettlement.findUnique({ where: { routeId } }),
      this.prisma.routeStop.count({ where: { routeId, status: StopStatus.PENDING } }),
    ]);

    return {
      expected: toExpectedDto(expected),
      settlement: settlement === null ? null : toSettlementDto(settlement),
      unresolvedStops,
    };
  }

  /**
   * FINISHED -> SETTLED, and nothing else — same idiom as RoutesService's
   * start()/finish(): the status guard lives in the WHERE clause of the
   * UPDATE itself, so two simultaneous settlements of the same route have
   * exactly one succeed, and the loser's `count === 0` aborts before any
   * RouteSettlement row is written.
   *
   * Never blocks on a mismatch (HU-17: a difference is registered, not
   * prevented — same philosophy as a route settlement in the spec and as
   * `creditLimitExceeded` elsewhere) and never blocks on a payment still
   * PENDING (it's counted in totalPendingConfirmation and resolved later in
   * the confirmation tray, #66). `differences` is computed here and returned
   * but never stored: everything it's built from (fullOut/fullDelivered/
   * fullSold/fullReturned already persisted, EMPTY_PICKUP always
   * reconstructible from the ledger) already exists, so storing it again
   * would be a fact that could drift from its own source.
   */
  async settle(
    routeId: string,
    dto: CreateRouteSettlementDto,
    actorId: string,
  ): Promise<CreateRouteSettlementResponseDto> {
    const route = await this.prisma.route.findUnique({
      where: { id: routeId },
      select: { id: true, status: true },
    });
    if (route === null) {
      throw new NotFoundException(`La ruta "${routeId}" no existe`);
    }

    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.route.updateMany({
        where: { id: routeId, status: RouteStatus.FINISHED },
        data: { status: RouteStatus.SETTLED },
      });
      if (count === 0) {
        throw new ConflictException(
          `Solo se puede liquidar una ruta terminada; esta está en ${route.status}`,
        );
      }

      const expected = await this.computeExpected(tx, routeId);

      const settlement = await tx.routeSettlement.create({
        data: {
          routeId,
          fullOut: expected.fullOut,
          fullDelivered: expected.fullDelivered,
          fullSold: expected.fullSold,
          fullReturned: dto.fullReturned,
          emptiesCollected: dto.emptiesCollected,
          totalSold: expected.totalSold,
          totalCollected: expected.totalCollected,
          totalCashCollected: expected.totalCashCollected,
          totalPendingConfirmation: expected.totalPendingConfirmation,
          totalOnCredit: expected.totalOnCredit,
          notes: dto.notes ?? null,
          settledById: actorId,
          settledAt: new Date(),
        },
      });

      return {
        settlement: toSettlementDto(settlement),
        differences: {
          containers:
            expected.fullOut - (expected.fullDelivered + expected.fullSold + dto.fullReturned),
          empties: expected.emptiesPickedUp - dto.emptiesCollected,
        },
      };
    });
  }
}
