import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Prisma, RouteStatus, UserRole } from "@prisma/client";
import { jest } from "@jest/globals";
import { PrismaService } from "../../prisma/prisma.service.js";
import type { RouteActor } from "../routes/routes.service.js";
import { RouteLocationsService, isWithoutSignal } from "./route-locations.service.js";

const ROUTE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ROUTE_ID = "22222222-2222-4222-8222-222222222222";
const DRIVER_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_DRIVER_ID = "55555555-5555-4555-8555-555555555555";
const VEHICLE_ID = "66666666-6666-4666-8666-666666666666";
const POINT_ID = "77777777-7777-4777-8777-777777777777";

const DRIVER: RouteActor = { id: DRIVER_ID, roles: [UserRole.DRIVER] };
const NOW = new Date("2026-10-19T15:00:00.000Z");
const MINUTE_MS = 60 * 1000;

function minutesBefore(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * MINUTE_MS);
}

function pointRow(recordedAt: Date) {
  return {
    latitude: new Prisma.Decimal("-12.046374"),
    longitude: new Prisma.Decimal("-77.042793"),
    accuracyM: null,
    recordedAt,
    receivedAt: recordedAt,
    vehicle: { plate: "ABC123" },
  };
}

function buildPrismaMock() {
  const tx = {
    $queryRaw: jest.fn<() => Promise<unknown>>().mockResolvedValue([]),
    route: {
      findUnique: jest.fn<() => Promise<unknown>>(),
      findUniqueOrThrow: jest.fn<() => Promise<unknown>>(),
    },
    routeLocationPoint: {
      createMany: jest.fn<() => Promise<unknown>>().mockResolvedValue({ count: 1 }),
    },
  };
  return {
    tx,
    prisma: {
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
      route: { findMany: jest.fn<() => Promise<unknown>>(), findUnique: tx.route.findUnique },
      routeLocationPoint: { findMany: jest.fn<() => Promise<unknown>>() },
    },
  };
}

async function buildService(prisma: ReturnType<typeof buildPrismaMock>["prisma"]) {
  const moduleRef = await Test.createTestingModule({
    providers: [RouteLocationsService, { provide: PrismaService, useValue: prisma }],
  }).compile();
  return moduleRef.get(RouteLocationsService);
}

const ONE_POINT = {
  points: [
    {
      clientPointId: POINT_ID,
      latitude: "-12.046374",
      longitude: "-77.042793",
      accuracyM: "8.40",
      recordedAt: "2026-10-19T14:55:00.000Z",
    },
  ],
};

describe("RouteLocationsService.recordPoints", () => {
  it("stores the point with the route's driver and its current vehicle, skipping repeats", async () => {
    const { prisma, tx } = buildPrismaMock();
    tx.route.findUnique.mockResolvedValue({ status: RouteStatus.IN_PROGRESS });
    tx.route.findUniqueOrThrow.mockResolvedValue({ driverId: DRIVER_ID, vehicleId: VEHICLE_ID });
    const service = await buildService(prisma);

    await expect(service.recordPoints(ROUTE_ID, ONE_POINT, DRIVER)).resolves.toEqual({
      received: 1,
      stored: 1,
    });
    expect(tx.routeLocationPoint.createMany).toHaveBeenCalledWith({
      data: [
        {
          clientPointId: POINT_ID,
          routeId: ROUTE_ID,
          driverId: DRIVER_ID,
          vehicleId: VEHICLE_ID,
          latitude: new Prisma.Decimal("-12.046374"),
          longitude: new Prisma.Decimal("-77.042793"),
          accuracyM: new Prisma.Decimal("8.40"),
          recordedAt: new Date("2026-10-19T14:55:00.000Z"),
        },
      ],
      skipDuplicates: true,
    });
  });

  it("refuses a driver sending for another driver's route", async () => {
    const { prisma, tx } = buildPrismaMock();
    tx.route.findUnique.mockResolvedValue({ status: RouteStatus.IN_PROGRESS });
    tx.route.findUniqueOrThrow.mockResolvedValue({
      driverId: OTHER_DRIVER_ID,
      vehicleId: VEHICLE_ID,
    });
    const service = await buildService(prisma);

    await expect(service.recordPoints(ROUTE_ID, ONE_POINT, DRIVER)).rejects.toThrow(
      ForbiddenException,
    );
    expect(tx.routeLocationPoint.createMany).not.toHaveBeenCalled();
  });

  it.each([RouteStatus.PLANNED, RouteStatus.FINISHED, RouteStatus.SETTLED])(
    "refuses a %s route",
    async (status) => {
      const { prisma, tx } = buildPrismaMock();
      tx.route.findUnique.mockResolvedValue({ status });
      tx.route.findUniqueOrThrow.mockResolvedValue({ driverId: DRIVER_ID, vehicleId: VEHICLE_ID });
      const service = await buildService(prisma);

      await expect(service.recordPoints(ROUTE_ID, ONE_POINT, DRIVER)).rejects.toThrow(
        ConflictException,
      );
      expect(tx.routeLocationPoint.createMany).not.toHaveBeenCalled();
    },
  );
});

describe("isWithoutSignal", () => {
  it("is without signal with no point, or past 15 minutes, and not before", () => {
    expect(isWithoutSignal(null, NOW)).toBe(true);
    expect(isWithoutSignal(minutesBefore(15), NOW)).toBe(false);
    expect(isWithoutSignal(minutesBefore(16), NOW)).toBe(true);
  });
});

describe("RouteLocationsService.listLive", () => {
  it("returns the last point of each route in progress and marks only the one 20 minutes old", async () => {
    const { prisma } = buildPrismaMock();
    prisma.route.findMany.mockResolvedValue([
      {
        id: ROUTE_ID,
        date: new Date("2026-10-19T00:00:00.000Z"),
        driver: { name: "Juan" },
        vehicle: { plate: "ABC123" },
        locationPoints: [pointRow(minutesBefore(3))],
      },
      {
        id: OTHER_ROUTE_ID,
        date: new Date("2026-10-19T00:00:00.000Z"),
        driver: { name: "Pedro" },
        vehicle: null,
        locationPoints: [pointRow(minutesBefore(20))],
      },
    ]);
    const service = await buildService(prisma);

    const live = await service.listLive(NOW);

    expect(live.staleAfterMinutes).toBe(15);
    expect(live.routes).toEqual([
      expect.objectContaining({
        routeId: ROUTE_ID,
        date: "2026-10-19",
        driverName: "Juan",
        vehiclePlate: "ABC123",
        noSignal: false,
        lastPoint: expect.objectContaining({
          latitude: "-12.046374",
          recordedAt: minutesBefore(3).toISOString(),
        }),
      }),
      expect.objectContaining({
        routeId: OTHER_ROUTE_ID,
        vehiclePlate: null,
        noSignal: true,
        lastPoint: expect.objectContaining({ recordedAt: minutesBefore(20).toISOString() }),
      }),
    ]);
    expect(prisma.route.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: RouteStatus.IN_PROGRESS } }),
    );
  });

  it("lists a route in progress that never sent a point as without signal", async () => {
    const { prisma } = buildPrismaMock();
    prisma.route.findMany.mockResolvedValue([
      {
        id: ROUTE_ID,
        date: new Date("2026-10-19T00:00:00.000Z"),
        driver: { name: "Juan" },
        vehicle: null,
        locationPoints: [],
      },
    ]);
    const service = await buildService(prisma);

    const live = await service.listLive(NOW);

    expect(live.routes[0]).toMatchObject({ lastPoint: null, noSignal: true });
  });
});

describe("RouteLocationsService.listRoutePoints", () => {
  it("answers 404 for a route that does not exist", async () => {
    const { prisma } = buildPrismaMock();
    prisma.route.findUnique.mockResolvedValue(null);
    const service = await buildService(prisma);

    await expect(service.listRoutePoints(ROUTE_ID)).rejects.toThrow(NotFoundException);
  });

  it("returns the track in order with the vehicle plate of each point", async () => {
    const { prisma } = buildPrismaMock();
    prisma.route.findUnique.mockResolvedValue({ id: ROUTE_ID });
    prisma.routeLocationPoint.findMany.mockResolvedValue([pointRow(minutesBefore(10))]);
    const service = await buildService(prisma);

    await expect(service.listRoutePoints(ROUTE_ID)).resolves.toEqual([
      {
        latitude: "-12.046374",
        longitude: "-77.042793",
        accuracyM: null,
        recordedAt: minutesBefore(10).toISOString(),
        receivedAt: minutesBefore(10).toISOString(),
        vehiclePlate: "ABC123",
      },
    ]);
  });
});
