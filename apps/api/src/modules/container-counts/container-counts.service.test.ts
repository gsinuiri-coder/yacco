import { BadRequestException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ContainerMovementType, ContainerState } from "@prisma/client";
import { jest } from "@jest/globals";
import { PrismaService } from "../../prisma/prisma.service.js";
import { ContainerMovementsService } from "../container-movements/container-movements.service.js";
import { ContainerCountsService } from "./container-counts.service.js";

const CONTAINER_TYPE_ID = "11111111-1111-4111-8111-111111111111";
const LOCATION_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const COUNT_ID = "44444444-4444-4444-8444-444444444444";
const MOVEMENT_ID = "55555555-5555-4555-8555-555555555555";

function containerTypeRow(overrides: Record<string, unknown> = {}) {
  return { id: CONTAINER_TYPE_ID, name: "Con caño", ...overrides };
}

function locationRow(overrides: Record<string, unknown> = {}) {
  return { id: LOCATION_ID, ...overrides };
}

function countRow(overrides: Record<string, unknown> = {}) {
  return {
    id: COUNT_ID,
    locationId: LOCATION_ID,
    location: { id: LOCATION_ID, name: "Bodega" },
    containerTypeId: CONTAINER_TYPE_ID,
    containerType: { id: CONTAINER_TYPE_ID, name: "Con caño" },
    countedAt: new Date("2026-08-24T05:00:00.000Z"),
    countedQuantity: 10,
    expectedQuantity: 10,
    adjustmentId: null,
    countedById: USER_ID,
    ...overrides,
  };
}

function firstCallData(mockFn: { mock: { calls: unknown[] } }): Record<string, unknown> {
  const args = mockFn.mock.calls[0] as [{ data: Record<string, unknown> }] | undefined;
  if (args === undefined) {
    throw new Error("expected the Prisma mock to have been called");
  }
  return args[0].data;
}

function buildPrismaMock() {
  return {
    containerType: { findUnique: jest.fn<() => Promise<unknown>>() },
    customerLocation: { findUnique: jest.fn<() => Promise<unknown>>() },
    customerContainerBalance: { findUnique: jest.fn<() => Promise<unknown>>() },
    containerCount: { create: jest.fn<() => Promise<unknown>>() },
    $transaction: jest.fn<(arg: unknown) => Promise<unknown>>(),
  };
}

describe("ContainerCountsService", () => {
  let service: ContainerCountsService;
  let prisma: ReturnType<typeof buildPrismaMock>;
  let containerMovementsService: { createWithinTransaction: jest.Mock };

  beforeEach(async () => {
    prisma = buildPrismaMock();
    prisma.$transaction.mockImplementation((arg) =>
      (arg as (tx: unknown) => Promise<unknown>)(prisma),
    );
    prisma.containerType.findUnique.mockResolvedValue(containerTypeRow());
    prisma.customerLocation.findUnique.mockResolvedValue(locationRow());
    containerMovementsService = {
      createWithinTransaction: jest
        .fn<() => Promise<unknown>>()
        .mockResolvedValue({ id: MOVEMENT_ID }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ContainerCountsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ContainerMovementsService, useValue: containerMovementsService },
      ],
    }).compile();

    service = moduleRef.get(ContainerCountsService);
  });

  it("rejects an unknown container type, without touching the balance", async () => {
    prisma.containerType.findUnique.mockResolvedValue(null);

    await expect(
      service.create(
        { locationId: LOCATION_ID, containerTypeId: CONTAINER_TYPE_ID, countedQuantity: 5 },
        USER_ID,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.customerContainerBalance.findUnique).not.toHaveBeenCalled();
    expect(prisma.containerCount.create).not.toHaveBeenCalled();
  });

  it("rejects an unknown location, without touching the balance", async () => {
    prisma.customerLocation.findUnique.mockResolvedValue(null);

    await expect(
      service.create(
        { locationId: LOCATION_ID, containerTypeId: CONTAINER_TYPE_ID, countedQuantity: 5 },
        USER_ID,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.containerCount.create).not.toHaveBeenCalled();
  });

  describe("a positive delta (counted > expected)", () => {
    it("emits a COUNT_ADJUSTMENT into WITH_CUSTOMER for the delta and links it as the adjustment", async () => {
      prisma.customerContainerBalance.findUnique.mockResolvedValue({ quantity: 6 });
      prisma.containerCount.create.mockResolvedValue(
        countRow({ countedQuantity: 10, expectedQuantity: 6, adjustmentId: MOVEMENT_ID }),
      );

      await service.create(
        { locationId: LOCATION_ID, containerTypeId: CONTAINER_TYPE_ID, countedQuantity: 10 },
        USER_ID,
      );

      expect(containerMovementsService.createWithinTransaction).toHaveBeenCalledTimes(1);
      const [, dto, countedById, options] =
        containerMovementsService.createWithinTransaction.mock.calls[0]!;
      expect(dto).toMatchObject({
        type: ContainerMovementType.COUNT_ADJUSTMENT,
        containerTypeId: CONTAINER_TYPE_ID,
        quantity: 4,
        toState: ContainerState.WITH_CUSTOMER,
        locationId: LOCATION_ID,
      });
      expect(countedById).toBe(USER_ID);
      expect(options).toMatchObject({ occurredAt: expect.any(Date) });

      const data = firstCallData(prisma.containerCount.create);
      expect(data.expectedQuantity).toBe(6);
      expect(data.countedQuantity).toBe(10);
      expect(data.adjustmentId).toBe(MOVEMENT_ID);
    });
  });

  describe("a negative delta (counted < expected)", () => {
    it("emits a COUNT_ADJUSTMENT out of WITH_CUSTOMER for the delta's magnitude", async () => {
      prisma.customerContainerBalance.findUnique.mockResolvedValue({ quantity: 10 });
      prisma.containerCount.create.mockResolvedValue(
        countRow({ countedQuantity: 3, expectedQuantity: 10, adjustmentId: MOVEMENT_ID }),
      );

      await service.create(
        { locationId: LOCATION_ID, containerTypeId: CONTAINER_TYPE_ID, countedQuantity: 3 },
        USER_ID,
      );

      const [, dto] = containerMovementsService.createWithinTransaction.mock.calls[0]!;
      expect(dto).toMatchObject({
        type: ContainerMovementType.COUNT_ADJUSTMENT,
        quantity: 7,
        fromState: ContainerState.WITH_CUSTOMER,
        locationId: LOCATION_ID,
      });

      const data = firstCallData(prisma.containerCount.create);
      expect(data.expectedQuantity).toBe(10);
      expect(data.countedQuantity).toBe(3);
      expect(data.adjustmentId).toBe(MOVEMENT_ID);
    });
  });

  describe("a zero delta (counted === expected)", () => {
    it("emits no movement, still records the count, and leaves adjustmentId null", async () => {
      prisma.customerContainerBalance.findUnique.mockResolvedValue({ quantity: 8 });
      prisma.containerCount.create.mockResolvedValue(
        countRow({ countedQuantity: 8, expectedQuantity: 8, adjustmentId: null }),
      );

      await service.create(
        { locationId: LOCATION_ID, containerTypeId: CONTAINER_TYPE_ID, countedQuantity: 8 },
        USER_ID,
      );

      expect(containerMovementsService.createWithinTransaction).not.toHaveBeenCalled();
      const data = firstCallData(prisma.containerCount.create);
      expect(data.expectedQuantity).toBe(8);
      expect(data.countedQuantity).toBe(8);
      expect(data.adjustmentId).toBeNull();
    });
  });

  it("defaults expectedQuantity to 0 when the location/container type has no balance row yet", async () => {
    prisma.customerContainerBalance.findUnique.mockResolvedValue(null);
    prisma.containerCount.create.mockResolvedValue(
      countRow({ countedQuantity: 5, expectedQuantity: 0, adjustmentId: MOVEMENT_ID }),
    );

    await service.create(
      { locationId: LOCATION_ID, containerTypeId: CONTAINER_TYPE_ID, countedQuantity: 5 },
      USER_ID,
    );

    const data = firstCallData(prisma.containerCount.create);
    expect(data.expectedQuantity).toBe(0);
    const [, dto] = containerMovementsService.createWithinTransaction.mock.calls[0]!;
    expect(dto).toMatchObject({ quantity: 5, toState: ContainerState.WITH_CUSTOMER });
  });

  it("persists a backdated countedAt, and passes the same instant as the movement's occurredAt", async () => {
    prisma.customerContainerBalance.findUnique.mockResolvedValue({ quantity: 6 });
    prisma.containerCount.create.mockResolvedValue(countRow());
    const backdated = new Date("2026-01-15T05:00:00.000Z");

    await service.create(
      { locationId: LOCATION_ID, containerTypeId: CONTAINER_TYPE_ID, countedQuantity: 10 },
      USER_ID,
      { occurredAt: backdated },
    );

    const data = firstCallData(prisma.containerCount.create);
    expect(data.countedAt).toBe(backdated);
    const [, , , options] = containerMovementsService.createWithinTransaction.mock.calls[0]!;
    expect(options).toEqual({ occurredAt: backdated });
  });

  it("defaults countedAt to now when none is given", async () => {
    prisma.customerContainerBalance.findUnique.mockResolvedValue({ quantity: 8 });
    prisma.containerCount.create.mockResolvedValue(countRow());
    const before = Date.now();

    await service.create(
      { locationId: LOCATION_ID, containerTypeId: CONTAINER_TYPE_ID, countedQuantity: 8 },
      USER_ID,
    );

    const after = Date.now();
    const data = firstCallData(prisma.containerCount.create);
    const persisted = data.countedAt as Date;
    expect(persisted.getTime()).toBeGreaterThanOrEqual(before);
    expect(persisted.getTime()).toBeLessThanOrEqual(after);
  });
});
