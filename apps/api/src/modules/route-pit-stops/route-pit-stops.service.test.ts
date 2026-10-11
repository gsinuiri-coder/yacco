import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Prisma, RouteStatus, UserRole } from "@prisma/client";
import { jest } from "@jest/globals";
import { PrismaService } from "../../prisma/prisma.service.js";
import { ContainerMovementsService } from "../container-movements/container-movements.service.js";
import { RoutePitStopsService } from "./route-pit-stops.service.js";
import type { RouteActor } from "../routes/routes.service.js";

const ROUTE_ID = "11111111-1111-4111-8111-111111111111";
const PIT_STOP_ID = "22222222-2222-4222-8222-222222222222";
const ADMIN_ID = "33333333-3333-4333-8333-333333333333";
const DRIVER_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_DRIVER_ID = "55555555-5555-4555-8555-555555555555";
const CT_CANO_ID = "66666666-6666-4666-8666-666666666666";
const CT_SIN_ID = "77777777-7777-4777-8777-777777777777";

const ADMIN_ACTOR: RouteActor = { id: ADMIN_ID, roles: [UserRole.ADMIN] };
const OTHER_DRIVER_ACTOR: RouteActor = { id: OTHER_DRIVER_ID, roles: [UserRole.DRIVER] };

function decimal(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function buildPrismaMock() {
  const tx = {
    $queryRaw: jest.fn<() => Promise<unknown>>().mockResolvedValue([]),
    route: {
      findUnique: jest.fn<() => Promise<unknown>>(),
    },
    routePitStop: {
      create: jest.fn<() => Promise<unknown>>(),
      findUniqueOrThrow: jest.fn<() => Promise<unknown>>(),
      findFirst: jest.fn<() => Promise<unknown>>(),
      update: jest.fn<() => Promise<unknown>>(),
      aggregate: jest.fn<() => Promise<unknown>>(),
    },
    routePitStopCount: {
      create: jest.fn<() => Promise<unknown>>(),
    },
    routeLoad: {
      create: jest.fn<() => Promise<unknown>>(),
      findMany: jest.fn<() => Promise<unknown>>().mockResolvedValue([]),
    },
    batchItem: {
      findUnique: jest.fn<() => Promise<unknown>>(),
      findFirst: jest.fn<() => Promise<unknown>>(),
      findMany: jest.fn<() => Promise<unknown>>().mockResolvedValue([]),
      update: jest.fn<() => Promise<unknown>>(),
      updateMany: jest.fn<() => Promise<unknown>>(),
    },
    containerMovement: {
      findMany: jest.fn<() => Promise<unknown>>().mockResolvedValue([]),
    },
    payment: {
      aggregate: jest.fn<() => Promise<unknown>>(),
    },
  };

  return {
    ...tx,
    routePitStop: {
      ...tx.routePitStop,
      findMany: jest.fn<() => Promise<unknown>>().mockResolvedValue([]),
    },
    containerType: {
      findMany: jest.fn<() => Promise<unknown>>().mockResolvedValue([]),
    },
    $transaction: jest.fn((cb: (client: typeof tx) => Promise<unknown>) => cb(tx)),
  };
}

describe("RoutePitStopsService", () => {
  let service: RoutePitStopsService;
  let prisma: ReturnType<typeof buildPrismaMock>;
  let containerMovements: {
    getRouteFullStockByType: jest.Mock<() => Promise<Map<string, number>>>;
    getRouteEmptyStockByType: jest.Mock<() => Promise<Map<string, number>>>;
    createWithinTransaction: jest.Mock<() => Promise<unknown>>;
  };

  beforeEach(async () => {
    prisma = buildPrismaMock();
    containerMovements = {
      getRouteFullStockByType: jest
        .fn<() => Promise<Map<string, number>>>()
        .mockResolvedValue(new Map()),
      getRouteEmptyStockByType: jest
        .fn<() => Promise<Map<string, number>>>()
        .mockResolvedValue(new Map()),
      createWithinTransaction: jest.fn<() => Promise<unknown>>().mockResolvedValue({}),
    };

    const module = await Test.createTestingModule({
      providers: [
        RoutePitStopsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ContainerMovementsService, useValue: containerMovements },
      ],
    }).compile();

    service = module.get(RoutePitStopsService);
  });

  describe("preview", () => {
    it("lanza NotFoundException si la ruta no existe", async () => {
      prisma.route.findUnique.mockResolvedValue(null);
      await expect(service.preview(ROUTE_ID, ADMIN_ACTOR)).rejects.toThrow(NotFoundException);
    });

    it("lanza ForbiddenException si un chofer intenta ver una ruta que no es la suya", async () => {
      prisma.route.findUnique.mockResolvedValue({
        id: ROUTE_ID,
        driverId: DRIVER_ID,
        status: RouteStatus.IN_PROGRESS,
      });
      await expect(service.preview(ROUTE_ID, OTHER_DRIVER_ACTOR)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("devuelve los valores calculados de envases y efectivo", async () => {
      prisma.route.findUnique.mockResolvedValue({
        id: ROUTE_ID,
        driverId: DRIVER_ID,
        status: RouteStatus.IN_PROGRESS,
      });
      prisma.containerType.findMany.mockResolvedValue([
        { id: CT_CANO_ID, name: "Con caño", active: true },
        { id: CT_SIN_ID, name: "Sin caño", active: true },
      ]);
      containerMovements.getRouteFullStockByType.mockResolvedValue(
        new Map([
          [CT_CANO_ID, 12],
          [CT_SIN_ID, 5],
        ]),
      );
      containerMovements.getRouteEmptyStockByType.mockResolvedValue(
        new Map([
          [CT_CANO_ID, 8],
          [CT_SIN_ID, 2],
        ]),
      );
      prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: decimal("250.00") } });
      prisma.routePitStop.aggregate.mockResolvedValue({
        _sum: { cashDelivered: decimal("100.00") },
      });

      const result = await service.preview(ROUTE_ID, ADMIN_ACTOR);

      expect(result.containers).toEqual([
        {
          containerTypeId: CT_CANO_ID,
          containerTypeName: "Con caño",
          expectedFull: 12,
          expectedEmpty: 8,
        },
        {
          containerTypeId: CT_SIN_ID,
          containerTypeName: "Sin caño",
          expectedFull: 5,
          expectedEmpty: 2,
        },
      ]);
      expect(result.cash).toEqual({
        cashCollected: "250.00",
        cashDeliveredInPreviousPits: "100.00",
        cashExpected: "150.00",
      });
    });
  });

  describe("create", () => {
    it("lanza NotFoundException si la ruta no existe", async () => {
      prisma.route.findUnique.mockResolvedValue(null);
      await expect(
        service.create(
          ROUTE_ID,
          { counts: [{ containerTypeId: CT_CANO_ID, countedFull: 0, countedEmpty: 0 }] },
          ADMIN_ACTOR,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it("lanza ConflictException si la ruta no está en curso", async () => {
      prisma.route.findUnique.mockResolvedValue({
        id: ROUTE_ID,
        driverId: DRIVER_ID,
        status: RouteStatus.PLANNED,
      });
      await expect(
        service.create(
          ROUTE_ID,
          { counts: [{ containerTypeId: CT_CANO_ID, countedFull: 0, countedEmpty: 0 }] },
          ADMIN_ACTOR,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it("lanza BadRequestException si el conteo repite un tipo de envase", async () => {
      prisma.route.findUnique.mockResolvedValue({
        id: ROUTE_ID,
        driverId: DRIVER_ID,
        status: RouteStatus.IN_PROGRESS,
      });
      await expect(
        service.create(
          ROUTE_ID,
          {
            counts: [
              { containerTypeId: CT_CANO_ID, countedFull: 2, countedEmpty: 1 },
              { containerTypeId: CT_CANO_ID, countedFull: 3, countedEmpty: 0 },
            ],
          },
          ADMIN_ACTOR,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("lanza BadRequestException si hay diferencia en el cuadre y falta el motivo", async () => {
      prisma.route.findUnique.mockResolvedValue({
        id: ROUTE_ID,
        driverId: DRIVER_ID,
        status: RouteStatus.IN_PROGRESS,
      });
      containerMovements.getRouteFullStockByType.mockResolvedValue(new Map([[CT_CANO_ID, 10]]));
      containerMovements.getRouteEmptyStockByType.mockResolvedValue(new Map([[CT_CANO_ID, 5]]));

      await expect(
        service.create(
          ROUTE_ID,
          {
            counts: [
              {
                containerTypeId: CT_CANO_ID,
                countedFull: 9,
                countedEmpty: 5,
                differenceReason: "",
              },
            ],
          },
          ADMIN_ACTOR,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("lanza BadRequestException si se entrega más efectivo de lo esperado y falta el motivo", async () => {
      prisma.route.findUnique.mockResolvedValue({
        id: ROUTE_ID,
        driverId: DRIVER_ID,
        status: RouteStatus.IN_PROGRESS,
      });
      containerMovements.getRouteFullStockByType.mockResolvedValue(new Map([[CT_CANO_ID, 10]]));
      containerMovements.getRouteEmptyStockByType.mockResolvedValue(new Map([[CT_CANO_ID, 5]]));
      prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: decimal("100.00") } });
      prisma.routePitStop.aggregate.mockResolvedValue({
        _sum: { cashDelivered: decimal("20.00") },
      });

      await expect(
        service.create(
          ROUTE_ID,
          {
            counts: [{ containerTypeId: CT_CANO_ID, countedFull: 10, countedEmpty: 5 }],
            cashDelivered: "90.00", // esperado es 80.00
            cashReason: "",
          },
          ADMIN_ACTOR,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("permite entregar menos que lo esperado sin pedir motivo", async () => {
      prisma.route.findUnique.mockResolvedValue({
        id: ROUTE_ID,
        driverId: DRIVER_ID,
        status: RouteStatus.IN_PROGRESS,
      });
      containerMovements.getRouteFullStockByType.mockResolvedValue(new Map([[CT_CANO_ID, 10]]));
      containerMovements.getRouteEmptyStockByType.mockResolvedValue(new Map([[CT_CANO_ID, 5]]));
      prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: decimal("100.00") } });
      prisma.routePitStop.aggregate.mockResolvedValue({
        _sum: { cashDelivered: decimal("20.00") },
      });

      const mockSavedPit = {
        id: PIT_STOP_ID,
        routeId: ROUTE_ID,
        recordedById: ADMIN_ID,
        recordedBy: { id: ADMIN_ID, name: "Admin" },
        createdAt: new Date(),
        notes: null,
        cashExpected: decimal("80.00"),
        cashDelivered: decimal("50.00"),
        cashReason: null,
        voidedAt: null,
        voidedById: null,
        voidedBy: null,
        voidReason: null,
        counts: [
          {
            id: "count-1",
            pitStopId: PIT_STOP_ID,
            containerTypeId: CT_CANO_ID,
            containerType: { id: CT_CANO_ID, name: "Con caño" },
            expectedFull: 10,
            countedFull: 10,
            expectedEmpty: 5,
            countedEmpty: 5,
            differenceReason: null,
          },
        ],
        loads: [],
        movements: [],
      };
      prisma.routePitStop.create.mockResolvedValue(mockSavedPit);
      prisma.routePitStop.findUniqueOrThrow.mockResolvedValue(mockSavedPit);

      const result = await service.create(
        ROUTE_ID,
        {
          counts: [{ containerTypeId: CT_CANO_ID, countedFull: 10, countedEmpty: 5 }],
          cashDelivered: "50.00",
        },
        ADMIN_ACTOR,
      );

      expect(result.id).toBe(PIT_STOP_ID);
      expect(result.cashExpected).toBe("80.00");
      expect(result.cashDelivered).toBe("50.00");
    });
  });

  describe("voidPitStop", () => {
    it("lanza BadRequestException si el motivo está vacío", async () => {
      await expect(
        service.voidPitStop(ROUTE_ID, PIT_STOP_ID, { voidReason: "" }, ADMIN_ACTOR),
      ).rejects.toThrow(BadRequestException);
    });

    it("lanza ConflictException si la ruta ya está SETTLED", async () => {
      prisma.route.findUnique.mockResolvedValue({ id: ROUTE_ID, status: RouteStatus.SETTLED });
      await expect(
        service.voidPitStop(ROUTE_ID, PIT_STOP_ID, { voidReason: "Error en conteo" }, ADMIN_ACTOR),
      ).rejects.toThrow(ConflictException);
    });

    it("lanza NotFoundException si la parada en planta no existe", async () => {
      prisma.route.findUnique.mockResolvedValue({ id: ROUTE_ID, status: RouteStatus.IN_PROGRESS });
      prisma.routePitStop.findFirst.mockResolvedValue(null);
      await expect(
        service.voidPitStop(ROUTE_ID, PIT_STOP_ID, { voidReason: "Error" }, ADMIN_ACTOR),
      ).rejects.toThrow(NotFoundException);
    });

    it("lanza ConflictException si la parada en planta ya fue anulada", async () => {
      prisma.route.findUnique.mockResolvedValue({ id: ROUTE_ID, status: RouteStatus.IN_PROGRESS });
      prisma.routePitStop.findFirst.mockResolvedValue({
        id: PIT_STOP_ID,
        routeId: ROUTE_ID,
        voidedAt: new Date(),
        createdAt: new Date("2026-10-11T12:00:00Z"),
      });
      await expect(
        service.voidPitStop(ROUTE_ID, PIT_STOP_ID, { voidReason: "Error" }, ADMIN_ACTOR),
      ).rejects.toThrow(ConflictException);
    });

    it("lanza ConflictException si no es la última parada en planta no anulada", async () => {
      prisma.route.findUnique.mockResolvedValue({ id: ROUTE_ID, status: RouteStatus.IN_PROGRESS });
      // Primer pit stop
      prisma.routePitStop.findFirst
        .mockResolvedValueOnce({
          id: PIT_STOP_ID,
          routeId: ROUTE_ID,
          voidedAt: null,
          createdAt: new Date("2026-10-11T12:00:00Z"),
        })
        // Pit stop posterior no anulado
        .mockResolvedValueOnce({
          id: "pit-newer",
          routeId: ROUTE_ID,
          voidedAt: null,
          createdAt: new Date("2026-10-11T14:00:00Z"),
        });

      await expect(
        service.voidPitStop(ROUTE_ID, PIT_STOP_ID, { voidReason: "Error" }, ADMIN_ACTOR),
      ).rejects.toThrow(ConflictException);
    });
  });
});
