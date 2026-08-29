import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  ContainerMovementType,
  ContainerState,
  PaymentStatus,
  Prisma,
  RouteStatus,
} from "@prisma/client";
import { jest } from "@jest/globals";
import { PrismaService } from "../../prisma/prisma.service.js";
import { ContainerMovementsService } from "../container-movements/container-movements.service.js";
import { RouteSettlementService } from "./route-settlement.service.js";

const ROUTE_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_ID = "22222222-2222-4222-8222-222222222222";
const MISSING_ID = "00000000-0000-4000-8000-000000000000";
const WITH_SPIGOT_ID = "33333333-3333-4333-8333-333333333333";
const WITHOUT_SPIGOT_ID = "44444444-4444-4444-8444-444444444444";

/** El catálogo que resuelve los nombres de las líneas por tipo. */
const CONTAINER_TYPES = [
  { id: WITH_SPIGOT_ID, name: "Con caño" },
  { id: WITHOUT_SPIGOT_ID, name: "Sin caño" },
];

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

interface GroupByArgs {
  where: { type?: ContainerMovementType };
}
interface FindManyArgs {
  where: { id: { in: string[] } };
}

/** Una línea del desglose, tal como la escribe quien cuenta en la puerta. */
function line(containerTypeId: string, quantity: number) {
  return { containerTypeId, quantity };
}

/** La fila que devuelve `routeSettlement.create`, en su forma mínima. */
function settledRow(overrides: Record<string, unknown> = {}) {
  return {
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
    settledAt: new Date("2026-08-29T20:00:00.000Z"),
    ...overrides,
  };
}

/**
 * containerMovement.groupBy se llama una vez por EMPTY_PICKUP (lo recogido,
 * dentro de computeExpected) y otra por EMPTY_UNLOAD (lo descargado, releído
 * después de emitir) — despacha por ese filtro, igual que el mock de aggregate.
 */
function groupByMock(rows: {
  pickedUp?: { containerTypeId: string; quantity: number }[];
  unloaded?: { containerTypeId: string; quantity: number }[];
}) {
  return jest.fn(async (args: GroupByArgs) => {
    const source =
      args.where.type === ContainerMovementType.EMPTY_UNLOAD
        ? (rows.unloaded ?? [])
        : (rows.pickedUp ?? []);
    return source.map((row) => ({
      containerTypeId: row.containerTypeId,
      _sum: { quantity: row.quantity },
    }));
  });
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
      groupBy: jest.fn<(args: GroupByArgs) => Promise<unknown>>(),
    },
    containerType: {
      findMany: jest.fn<(args: FindManyArgs) => Promise<unknown>>(),
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
  let containerMovements: { createWithinTransaction: jest.Mock<() => Promise<unknown>> };

  beforeEach(async () => {
    prisma = buildPrismaMock();
    prisma.$transaction.mockImplementation((arg) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => Promise<unknown>)(prisma),
    );
    // Por defecto no hay desglose por tipo: los tests que van sobre los vacíos
    // lo dicen explícitamente.
    prisma.containerMovement.groupBy.mockImplementation(groupByMock({}));
    prisma.containerType.findMany.mockImplementation(async (args: FindManyArgs) =>
      CONTAINER_TYPES.filter((containerType) => args.where.id.in.includes(containerType.id)),
    );
    containerMovements = { createWithinTransaction: jest.fn<() => Promise<unknown>>() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RouteSettlementService,
        { provide: PrismaService, useValue: prisma },
        { provide: ContainerMovementsService, useValue: containerMovements },
      ],
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
        containerMovementAggregateMock({ fullDelivered: 10, fullSold: 4, emptiesPickedUp: 14 }),
      );
      prisma.sale.aggregate.mockResolvedValue({ _sum: { total: decimal("320.00") } });
      prisma.payment.aggregate.mockImplementation(
        paymentAggregateMock({ collected: "280.00", cash: "150.00", pending: "130.00" }),
      );
      prisma.containerMovement.groupBy.mockImplementation(
        groupByMock({ pickedUp: [line(WITH_SPIGOT_ID, 11), line(WITHOUT_SPIGOT_ID, 3)] }),
      );
      prisma.routeSettlement.findUnique.mockResolvedValue(null);
      prisma.routeStop.count.mockResolvedValue(2);

      const result = await service.getSettlementView(ROUTE_ID);

      expect(result.settlement).toBeNull();
      expect(result.unresolvedStops).toBe(2);
      // `emptiesPickedUp` viaja en la vista previa porque es el número contra
      // el que se cuentan los vacíos en la puerta — y su desglose por tipo,
      // porque es por tipo que se cuentan.
      expect(result.expected).toEqual({
        fullOut: 20,
        fullDelivered: 10,
        fullSold: 4,
        emptiesPickedUp: 14,
        emptiesPickedUpByType: [
          { containerTypeId: WITH_SPIGOT_ID, containerTypeName: "Con caño", quantity: 11 },
          { containerTypeId: WITHOUT_SPIGOT_ID, containerTypeName: "Sin caño", quantity: 3 },
        ],
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
      // Lo contado se relee del ledger, no de la fila: `empties_collected`
      // guarda el total y los EMPTY_UNLOAD guardan de qué tipo era cada uno.
      prisma.containerMovement.groupBy.mockImplementation(
        groupByMock({ unloaded: [line(WITH_SPIGOT_ID, 14)] }),
      );

      const result = await service.getSettlementView(ROUTE_ID);

      expect(result.settlement).not.toBeNull();
      expect(result.settlement?.fullReturned).toBe(6);
      expect(result.settlement?.emptiesCollected).toBe(14);
      expect(result.settlement?.emptiesCollectedByType).toEqual([
        { containerTypeId: WITH_SPIGOT_ID, containerTypeName: "Con caño", quantity: 14 },
      ]);
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
        service.settle(MISSING_ID, { fullReturned: 0, emptiesCollected: [] }, ADMIN_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("a route still IN_PROGRESS is rejected with 409 naming its current state", async () => {
      prisma.route.findUnique.mockResolvedValue({ id: ROUTE_ID, status: RouteStatus.IN_PROGRESS });
      prisma.route.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.settle(ROUTE_ID, { fullReturned: 0, emptiesCollected: [] }, ADMIN_ID),
      ).rejects.toThrow(/IN_PROGRESS/);
      expect(prisma.routeSettlement.create).not.toHaveBeenCalled();
    });

    it("a route still PLANNED is rejected with 409 naming its current state", async () => {
      prisma.route.findUnique.mockResolvedValue({ id: ROUTE_ID, status: RouteStatus.PLANNED });
      prisma.route.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.settle(ROUTE_ID, { fullReturned: 0, emptiesCollected: [] }, ADMIN_ID),
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

      // Lo recogido según el libro y lo descargado coinciden: el desglose
      // existe igual, con su diferencia en cero.
      prisma.containerMovement.groupBy.mockImplementation(
        groupByMock({ pickedUp: [line(WITH_SPIGOT_ID, 14)], unloaded: [line(WITH_SPIGOT_ID, 14)] }),
      );

      const result = await service.settle(
        ROUTE_ID,
        { fullReturned: 6, emptiesCollected: [line(WITH_SPIGOT_ID, 14)] },
        ADMIN_ID,
      );

      // fullOut(20) = fullDelivered(10) + fullSold(4) + fullReturned(6)
      expect(result.differences).toEqual({
        containers: 0,
        empties: 0,
        emptiesByType: [
          { containerTypeId: WITH_SPIGOT_ID, containerTypeName: "Con caño", difference: 0 },
        ],
      });
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
        { fullReturned: 4, emptiesCollected: [line(WITH_SPIGOT_ID, 14)] },
        ADMIN_ID,
      );

      expect(result.differences.containers).toBe(2);
      expect(prisma.routeSettlement.create).toHaveBeenCalled();
    });

    it("emite un EMPTY_UNLOAD por cada línea contada, con su tipo y su cantidad", async () => {
      prisma.route.findUnique.mockResolvedValue({ id: ROUTE_ID, status: RouteStatus.FINISHED });
      prisma.route.updateMany.mockResolvedValue({ count: 1 });
      mockLedger({ emptiesPickedUp: 14, totalSold: "0.00", collected: "0.00" });
      prisma.routeSettlement.create.mockResolvedValue(settledRow({ emptiesCollected: 14 }));

      await service.settle(
        ROUTE_ID,
        {
          fullReturned: 0,
          emptiesCollected: [line(WITH_SPIGOT_ID, 11), line(WITHOUT_SPIGOT_ID, 3)],
        },
        ADMIN_ID,
      );

      expect(containerMovements.createWithinTransaction).toHaveBeenCalledTimes(2);
      expect(containerMovements.createWithinTransaction).toHaveBeenNthCalledWith(
        1,
        prisma,
        {
          type: ContainerMovementType.EMPTY_UNLOAD,
          containerTypeId: WITH_SPIGOT_ID,
          quantity: 11,
          fromState: ContainerState.EMPTY_ON_ROUTE,
          toState: ContainerState.EMPTY_AT_PLANT,
        },
        ADMIN_ID,
        // Sin locationId (no toca "en cliente") y sin stopId (la descarga es
        // de la ruta entera).
        { routeId: ROUTE_ID },
      );
    });

    it("el total persistido es la suma de las líneas, y una línea en cero no emite nada", async () => {
      prisma.route.findUnique.mockResolvedValue({ id: ROUTE_ID, status: RouteStatus.FINISHED });
      prisma.route.updateMany.mockResolvedValue({ count: 1 });
      mockLedger({ emptiesPickedUp: 8, totalSold: "0.00", collected: "0.00" });
      prisma.routeSettlement.create.mockResolvedValue(settledRow({ emptiesCollected: 8 }));

      await service.settle(
        ROUTE_ID,
        {
          fullReturned: 0,
          emptiesCollected: [line(WITH_SPIGOT_ID, 8), line(WITHOUT_SPIGOT_ID, 0)],
        },
        ADMIN_ID,
      );

      expect(containerMovements.createWithinTransaction).toHaveBeenCalledTimes(1);
      expect(prisma.routeSettlement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ emptiesCollected: 8 }) as unknown,
        }),
      );
    });

    it("repetir un tipo de envase es un 400, antes de tocar nada", async () => {
      prisma.route.findUnique.mockResolvedValue({ id: ROUTE_ID, status: RouteStatus.FINISHED });

      await expect(
        service.settle(
          ROUTE_ID,
          {
            fullReturned: 0,
            emptiesCollected: [line(WITH_SPIGOT_ID, 4), line(WITH_SPIGOT_ID, 2)],
          },
          ADMIN_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(containerMovements.createWithinTransaction).not.toHaveBeenCalled();
    });

    // Dos tipos que se compensan: el total da cero y esconde dos hallazgos.
    it("dos tipos que se compensan dejan el total en cero y el desglose en dos diferencias", async () => {
      prisma.route.findUnique.mockResolvedValue({ id: ROUTE_ID, status: RouteStatus.FINISHED });
      prisma.route.updateMany.mockResolvedValue({ count: 1 });
      mockLedger({ emptiesPickedUp: 14, totalSold: "0.00", collected: "0.00" });
      prisma.containerMovement.groupBy.mockImplementation(
        groupByMock({
          pickedUp: [line(WITH_SPIGOT_ID, 11), line(WITHOUT_SPIGOT_ID, 3)],
          unloaded: [line(WITH_SPIGOT_ID, 8), line(WITHOUT_SPIGOT_ID, 6)],
        }),
      );
      prisma.routeSettlement.create.mockResolvedValue(settledRow({ emptiesCollected: 14 }));

      const result = await service.settle(
        ROUTE_ID,
        {
          fullReturned: 0,
          emptiesCollected: [line(WITH_SPIGOT_ID, 8), line(WITHOUT_SPIGOT_ID, 6)],
        },
        ADMIN_ID,
      );

      expect(result.differences.empties).toBe(0);
      expect(result.differences.emptiesByType).toEqual([
        { containerTypeId: WITH_SPIGOT_ID, containerTypeName: "Con caño", difference: 3 },
        { containerTypeId: WITHOUT_SPIGOT_ID, containerTypeName: "Sin caño", difference: -3 },
      ]);
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

      await service.settle(ROUTE_ID, { fullReturned: 0, emptiesCollected: [] }, ADMIN_ID);
      expect(prisma.routeSettlement.create).toHaveBeenCalledTimes(1);

      prisma.route.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(
        service.settle(ROUTE_ID, { fullReturned: 0, emptiesCollected: [] }, ADMIN_ID),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.routeSettlement.create).toHaveBeenCalledTimes(1);
    });
  });
});
