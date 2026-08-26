import { ConflictException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ContainerMovementType, PaymentStatus, Prisma, RouteStatus } from "@prisma/client";
import { jest } from "@jest/globals";
import { PrismaService } from "../../prisma/prisma.service.js";
import { RouteSettlementService } from "./route-settlement.service.js";

const ROUTE_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_ID = "22222222-2222-4222-8222-222222222222";
const MISSING_ID = "00000000-0000-4000-8000-000000000000";

function decimal(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

interface AggregateArgs {
  where: {
    type?: ContainerMovementType;
    status?: PaymentStatus | { in: PaymentStatus[] };
    paymentMethod?: unknown;
  };
}

/**
 * containerMovement.aggregate is called three times per settle()/getSettlementView()
 * with different `where.type` filters — this dispatches by that filter so a
 * single mock can stand in for all three.
 */
function containerMovementAggregateMock(sums: {
  fullDelivered?: number | undefined;
  fullSold?: number | undefined;
  emptiesPickedUp?: number | undefined;
}) {
  return jest.fn(async (args: AggregateArgs) => {
    if (args.where.type === ContainerMovementType.LOAN_DELIVERY) {
      return { _sum: { quantity: sums.fullDelivered ?? null } };
    }
    if (args.where.type === ContainerMovementType.FULL_SALE) {
      return { _sum: { quantity: sums.fullSold ?? null } };
    }
    if (args.where.type === ContainerMovementType.EMPTY_PICKUP) {
      return { _sum: { quantity: sums.emptiesPickedUp ?? null } };
    }
    throw new Error(`unexpected containerMovement.aggregate call: ${JSON.stringify(args)}`);
  });
}

/**
 * payment.aggregate is called three times with different filters —
 * dispatches by the shape of `where` (a `paymentMethod` filter means "cash";
 * `status: PENDING` alone means "pending"; anything else is "collected").
 */
function paymentAggregateMock(sums: {
  collected?: string | undefined;
  cash?: string | undefined;
  pending?: string | undefined;
}) {
  return jest.fn(async (args: AggregateArgs) => {
    if (args.where.paymentMethod !== undefined) {
      return { _sum: { amount: sums.cash !== undefined ? decimal(sums.cash) : null } };
    }
    if (args.where.status === PaymentStatus.PENDING) {
      return { _sum: { amount: sums.pending !== undefined ? decimal(sums.pending) : null } };
    }
    return { _sum: { amount: sums.collected !== undefined ? decimal(sums.collected) : null } };
  });
}

function buildPrismaMock() {
  return {
    route: {
      findUnique: jest.fn<() => Promise<unknown>>(),
      updateMany: jest.fn<() => Promise<unknown>>(),
    },
    routeLoad: {
      aggregate: jest.fn<() => Promise<unknown>>(),
    },
    containerMovement: {
      aggregate: jest.fn<(args: AggregateArgs) => Promise<unknown>>(),
    },
    sale: {
      aggregate: jest.fn<() => Promise<unknown>>(),
    },
    payment: {
      aggregate: jest.fn<(args: AggregateArgs) => Promise<unknown>>(),
    },
    routeSettlement: {
      findUnique: jest.fn<() => Promise<unknown>>(),
      create: jest.fn<() => Promise<unknown>>(),
    },
    routeStop: {
      count: jest.fn<() => Promise<unknown>>(),
    },
    $transaction: jest.fn<(arg: unknown) => Promise<unknown>>(),
  };
}

describe("RouteSettlementService", () => {
  let service: RouteSettlementService;
  let prisma: ReturnType<typeof buildPrismaMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock();
    prisma.$transaction.mockImplementation((arg) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => Promise<unknown>)(prisma),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [RouteSettlementService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(RouteSettlementService);
  });

  describe("getSettlementView", () => {
    it("an unknown route is rejected with 404", async () => {
      prisma.route.findUnique.mockResolvedValue(null);

      await expect(service.getSettlementView(MISSING_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it("before settling: settlement is null, expected is computed from the ledger", async () => {
      prisma.route.findUnique.mockResolvedValue({ id: ROUTE_ID });
      prisma.routeLoad.aggregate.mockResolvedValue({ _sum: { quantity: 20 } });
      prisma.containerMovement.aggregate.mockImplementation(
        containerMovementAggregateMock({ fullDelivered: 10, fullSold: 4 }),
      );
      prisma.sale.aggregate.mockResolvedValue({ _sum: { total: decimal("320.00") } });
      prisma.payment.aggregate.mockImplementation(
        paymentAggregateMock({ collected: "280.00", cash: "150.00", pending: "130.00" }),
      );
      prisma.routeSettlement.findUnique.mockResolvedValue(null);
      prisma.routeStop.count.mockResolvedValue(2);

      const result = await service.getSettlementView(ROUTE_ID);

      expect(result.settlement).toBeNull();
      expect(result.unresolvedStops).toBe(2);
      expect(result.expected).toEqual({
        fullOut: 20,
        fullDelivered: 10,
        fullSold: 4,
        totalSold: "320.00",
        totalCollected: "280.00",
        totalCashCollected: "150.00",
        totalPendingConfirmation: "130.00",
        totalOnCredit: "40.00",
      });
    });

    it("totalSold = totalCollected + totalOnCredit exactly, with non-round decimals", async () => {
      prisma.route.findUnique.mockResolvedValue({ id: ROUTE_ID });
      prisma.routeLoad.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });
      prisma.containerMovement.aggregate.mockImplementation(containerMovementAggregateMock({}));
      prisma.sale.aggregate.mockResolvedValue({ _sum: { total: decimal("123.45") } });
      prisma.payment.aggregate.mockImplementation(
        paymentAggregateMock({ collected: "67.89", cash: "67.89" }),
      );
      prisma.routeSettlement.findUnique.mockResolvedValue(null);
      prisma.routeStop.count.mockResolvedValue(0);

      const result = await service.getSettlementView(ROUTE_ID);

      expect(result.expected.totalSold).toBe("123.45");
      expect(result.expected.totalCollected).toBe("67.89");
      expect(result.expected.totalOnCredit).toBe("55.56");
    });

    it("excludes REJECTED payments from totalCollected by construction (only CONFIRMED/PENDING in the filter)", async () => {
      prisma.route.findUnique.mockResolvedValue({ id: ROUTE_ID });
      prisma.routeLoad.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });
      prisma.containerMovement.aggregate.mockImplementation(containerMovementAggregateMock({}));
      prisma.sale.aggregate.mockResolvedValue({ _sum: { total: decimal("0.00") } });
      prisma.payment.aggregate.mockImplementation(paymentAggregateMock({}));
      prisma.routeSettlement.findUnique.mockResolvedValue(null);
      prisma.routeStop.count.mockResolvedValue(0);

      await service.getSettlementView(ROUTE_ID);

      const collectedCall = prisma.payment.aggregate.mock.calls.find(
        ([args]) =>
          (args as AggregateArgs).where.paymentMethod === undefined &&
          (args as AggregateArgs).where.status !== PaymentStatus.PENDING,
      );
      expect(collectedCall).toBeDefined();
      const where = (collectedCall as [AggregateArgs])[0].where;
      expect(where.status).toEqual({ in: [PaymentStatus.CONFIRMED, PaymentStatus.PENDING] });
    });

    it("after settling: returns the persisted settlement alongside expected", async () => {
      prisma.route.findUnique.mockResolvedValue({ id: ROUTE_ID });
      prisma.routeLoad.aggregate.mockResolvedValue({ _sum: { quantity: 20 } });
      prisma.containerMovement.aggregate.mockImplementation(
        containerMovementAggregateMock({ fullDelivered: 10, fullSold: 4 }),
      );
      prisma.sale.aggregate.mockResolvedValue({ _sum: { total: decimal("320.00") } });
      prisma.payment.aggregate.mockImplementation(
        paymentAggregateMock({ collected: "280.00", cash: "150.00", pending: "130.00" }),
      );
      prisma.routeSettlement.findUnique.mockResolvedValue({
        routeId: ROUTE_ID,
        fullOut: 20,
        fullDelivered: 10,
        fullSold: 4,
        fullReturned: 6,
        emptiesCollected: 14,
        totalSold: decimal("320.00"),
        totalCollected: decimal("280.00"),
        totalCashCollected: decimal("150.00"),
        totalPendingConfirmation: decimal("130.00"),
        totalOnCredit: decimal("40.00"),
        notes: null,
        settledById: ADMIN_ID,
        settledAt: new Date("2026-08-26T20:00:00.000Z"),
      });
      prisma.routeStop.count.mockResolvedValue(0);

      const result = await service.getSettlementView(ROUTE_ID);

      expect(result.settlement).not.toBeNull();
      expect(result.settlement?.fullReturned).toBe(6);
      expect(result.settlement?.emptiesCollected).toBe(14);
      expect(result.settlement?.settledById).toBe(ADMIN_ID);
    });
  });

  describe("settle", () => {
    function mockLedger(overrides: {
      fullOut?: number;
      fullDelivered?: number;
      fullSold?: number;
      emptiesPickedUp?: number;
      totalSold?: string;
      collected?: string;
      cash?: string;
      pending?: string;
    }) {
      prisma.routeLoad.aggregate.mockResolvedValue({ _sum: { quantity: overrides.fullOut ?? 0 } });
      prisma.containerMovement.aggregate.mockImplementation(
        containerMovementAggregateMock({
          fullDelivered: overrides.fullDelivered,
          fullSold: overrides.fullSold,
          emptiesPickedUp: overrides.emptiesPickedUp,
        }),
      );
      prisma.sale.aggregate.mockResolvedValue({
        _sum: { total: overrides.totalSold !== undefined ? decimal(overrides.totalSold) : null },
      });
      prisma.payment.aggregate.mockImplementation(
        paymentAggregateMock({
          collected: overrides.collected,
          cash: overrides.cash,
          pending: overrides.pending,
        }),
      );
    }

    it("an unknown route is rejected with 404 before opening any transaction", async () => {
      prisma.route.findUnique.mockResolvedValue(null);

      await expect(
        service.settle(MISSING_ID, { fullReturned: 0, emptiesCollected: 0 }, ADMIN_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("a route still IN_PROGRESS is rejected with 409 naming its current state", async () => {
      prisma.route.findUnique.mockResolvedValue({ id: ROUTE_ID, status: RouteStatus.IN_PROGRESS });
      prisma.route.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.settle(ROUTE_ID, { fullReturned: 0, emptiesCollected: 0 }, ADMIN_ID),
      ).rejects.toThrow(/IN_PROGRESS/);
      expect(prisma.routeSettlement.create).not.toHaveBeenCalled();
    });

    it("a route still PLANNED is rejected with 409 naming its current state", async () => {
      prisma.route.findUnique.mockResolvedValue({ id: ROUTE_ID, status: RouteStatus.PLANNED });
      prisma.route.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.settle(ROUTE_ID, { fullReturned: 0, emptiesCollected: 0 }, ADMIN_ID),
      ).rejects.toThrow(/PLANNED/);
      expect(prisma.routeSettlement.create).not.toHaveBeenCalled();
    });

    it("a route that matches exactly: differences are both zero", async () => {
      prisma.route.findUnique.mockResolvedValue({ id: ROUTE_ID, status: RouteStatus.FINISHED });
      prisma.route.updateMany.mockResolvedValue({ count: 1 });
      mockLedger({
        fullOut: 20,
        fullDelivered: 10,
        fullSold: 4,
        emptiesPickedUp: 14,
        totalSold: "320.00",
        collected: "280.00",
        cash: "150.00",
        pending: "130.00",
      });
      prisma.routeSettlement.create.mockResolvedValue({
        routeId: ROUTE_ID,
        fullOut: 20,
        fullDelivered: 10,
        fullSold: 4,
        fullReturned: 6,
        emptiesCollected: 14,
        totalSold: decimal("320.00"),
        totalCollected: decimal("280.00"),
        totalCashCollected: decimal("150.00"),
        totalPendingConfirmation: decimal("130.00"),
        totalOnCredit: decimal("40.00"),
        notes: null,
        settledById: ADMIN_ID,
        settledAt: new Date(),
      });

      const result = await service.settle(
        ROUTE_ID,
        { fullReturned: 6, emptiesCollected: 14 },
        ADMIN_ID,
      );

      // fullOut(20) = fullDelivered(10) + fullSold(4) + fullReturned(6)
      expect(result.differences).toEqual({ containers: 0, empties: 0 });
      expect(prisma.routeSettlement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            fullOut: 20,
            fullDelivered: 10,
            fullSold: 4,
            fullReturned: 6,
            emptiesCollected: 14,
            settledById: ADMIN_ID,
          }) as unknown,
        }),
      );
    });

    it("a container shortfall settles anyway and reports the difference", async () => {
      prisma.route.findUnique.mockResolvedValue({ id: ROUTE_ID, status: RouteStatus.FINISHED });
      prisma.route.updateMany.mockResolvedValue({ count: 1 });
      mockLedger({
        fullOut: 20,
        fullDelivered: 10,
        fullSold: 4,
        emptiesPickedUp: 14,
        totalSold: "320.00",
        collected: "320.00",
      });
      prisma.routeSettlement.create.mockResolvedValue({
        routeId: ROUTE_ID,
        fullOut: 20,
        fullDelivered: 10,
        fullSold: 4,
        fullReturned: 4, // 2 short of the 6 that would balance
        emptiesCollected: 14,
        totalSold: decimal("320.00"),
        totalCollected: decimal("320.00"),
        totalCashCollected: decimal("320.00"),
        totalPendingConfirmation: decimal("0.00"),
        totalOnCredit: decimal("0.00"),
        notes: null,
        settledById: ADMIN_ID,
        settledAt: new Date(),
      });

      const result = await service.settle(
        ROUTE_ID,
        { fullReturned: 4, emptiesCollected: 14 },
        ADMIN_ID,
      );

      expect(result.differences.containers).toBe(2);
      expect(prisma.routeSettlement.create).toHaveBeenCalled();
    });

    it("a second settle attempt is rejected with 409, and only one settlement exists", async () => {
      prisma.route.findUnique.mockResolvedValue({ id: ROUTE_ID, status: RouteStatus.FINISHED });
      prisma.route.updateMany.mockResolvedValueOnce({ count: 1 });
      mockLedger({ fullOut: 0, totalSold: "0.00", collected: "0.00" });
      prisma.routeSettlement.create.mockResolvedValue({
        routeId: ROUTE_ID,
        fullOut: 0,
        fullDelivered: 0,
        fullSold: 0,
        fullReturned: 0,
        emptiesCollected: 0,
        totalSold: decimal("0.00"),
        totalCollected: decimal("0.00"),
        totalCashCollected: decimal("0.00"),
        totalPendingConfirmation: decimal("0.00"),
        totalOnCredit: decimal("0.00"),
        notes: null,
        settledById: ADMIN_ID,
        settledAt: new Date(),
      });

      await service.settle(ROUTE_ID, { fullReturned: 0, emptiesCollected: 0 }, ADMIN_ID);
      expect(prisma.routeSettlement.create).toHaveBeenCalledTimes(1);

      prisma.route.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(
        service.settle(ROUTE_ID, { fullReturned: 0, emptiesCollected: 0 }, ADMIN_ID),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.routeSettlement.create).toHaveBeenCalledTimes(1);
    });
  });
});
