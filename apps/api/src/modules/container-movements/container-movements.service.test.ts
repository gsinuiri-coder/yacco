import { BadRequestException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ContainerMovementType, ContainerState, Prisma } from "@prisma/client";
import { jest } from "@jest/globals";
import { PrismaService } from "../../prisma/prisma.service.js";
import { ContainerMovementsService } from "./container-movements.service.js";

const CONTAINER_TYPE_ID = "11111111-1111-4111-8111-111111111111";
const LOCATION_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const MOVEMENT_ID = "44444444-4444-4444-8444-444444444444";

function containerTypeRow(overrides: Record<string, unknown> = {}) {
  return { id: CONTAINER_TYPE_ID, name: "Con caño", active: true, ...overrides };
}

function locationRow(overrides: Record<string, unknown> = {}) {
  return { id: LOCATION_ID, ...overrides };
}

function movementRow(overrides: Record<string, unknown> = {}) {
  return {
    id: MOVEMENT_ID,
    occurredAt: new Date("2026-08-22T12:00:00.000Z"),
    type: ContainerMovementType.FLEET_ENTRY,
    containerTypeId: CONTAINER_TYPE_ID,
    containerType: { id: CONTAINER_TYPE_ID, name: "Con caño" },
    quantity: 10,
    fromState: null,
    toState: ContainerState.EMPTY_AT_PLANT,
    locationId: null,
    location: null,
    recordedById: USER_ID,
    ...overrides,
  };
}

/** Reads the `data` payload the service handed a Prisma mock. */
function firstCallData(mockFn: { mock: { calls: unknown[] } }): Record<string, unknown> {
  const args = mockFn.mock.calls[0] as [{ data: Record<string, unknown> }] | undefined;
  if (args === undefined) {
    throw new Error("expected the Prisma mock to have been called");
  }
  return args[0].data;
}

/** Reads the first argument a Prisma mock was called with, whatever its shape. */
function firstCallArg<T>(mockFn: { mock: { calls: unknown[] } }): T {
  const args = mockFn.mock.calls[0] as [T] | undefined;
  if (args === undefined) {
    throw new Error("expected the Prisma mock to have been called");
  }
  return args[0];
}

function buildPrismaMock() {
  return {
    containerMovement: {
      create: jest.fn<() => Promise<unknown>>(),
      findMany: jest.fn<() => Promise<unknown>>(),
      count: jest.fn<() => Promise<unknown>>(),
      groupBy: jest.fn<() => Promise<unknown>>(),
    },
    containerType: {
      findUnique: jest.fn<() => Promise<unknown>>(),
      findMany: jest.fn<() => Promise<unknown>>(),
    },
    customerLocation: { findUnique: jest.fn<() => Promise<unknown>>() },
    customerContainerBalance: {
      findUnique: jest.fn<() => Promise<unknown>>(),
      upsert: jest.fn<() => Promise<unknown>>(),
    },
    $transaction: jest.fn<(arg: unknown) => Promise<unknown>>(),
  };
}

describe("ContainerMovementsService", () => {
  let service: ContainerMovementsService;
  let prisma: ReturnType<typeof buildPrismaMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock();
    // create() passes a callback; findAll() passes an array of operations.
    prisma.$transaction.mockImplementation((arg) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => Promise<unknown>)(prisma),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [ContainerMovementsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(ContainerMovementsService);
  });

  describe("create", () => {
    it("rejects a state pair the type does not allow, without touching the database", async () => {
      await expect(
        service.create(
          {
            type: ContainerMovementType.FLEET_ENTRY,
            containerTypeId: CONTAINER_TYPE_ID,
            quantity: 10,
            toState: ContainerState.FULL_AT_PLANT,
          },
          USER_ID,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.containerType.findUnique).not.toHaveBeenCalled();
      expect(prisma.containerMovement.create).not.toHaveBeenCalled();
    });

    it("rejects both states omitted — that is not a movement", async () => {
      await expect(
        service.create(
          { type: ContainerMovementType.FILLING, containerTypeId: CONTAINER_TYPE_ID, quantity: 5 },
          USER_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects an unknown container type", async () => {
      prisma.containerType.findUnique.mockResolvedValue(null);

      await expect(
        service.create(
          {
            type: ContainerMovementType.FLEET_ENTRY,
            containerTypeId: CONTAINER_TYPE_ID,
            quantity: 10,
            toState: ContainerState.EMPTY_AT_PLANT,
          },
          USER_ID,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.containerMovement.create).not.toHaveBeenCalled();
    });

    it('rejects a movement touching "with the customer" without a locationId', async () => {
      prisma.containerType.findUnique.mockResolvedValue(containerTypeRow());

      await expect(
        service.create(
          {
            type: ContainerMovementType.LOAN_DELIVERY,
            containerTypeId: CONTAINER_TYPE_ID,
            quantity: 5,
            fromState: ContainerState.FULL_ON_ROUTE,
            toState: ContainerState.WITH_CUSTOMER,
          },
          USER_ID,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.containerMovement.create).not.toHaveBeenCalled();
    });

    it("rejects an unknown location", async () => {
      prisma.containerType.findUnique.mockResolvedValue(containerTypeRow());
      prisma.customerLocation.findUnique.mockResolvedValue(null);

      await expect(
        service.create(
          {
            type: ContainerMovementType.LOAN_DELIVERY,
            containerTypeId: CONTAINER_TYPE_ID,
            quantity: 5,
            fromState: ContainerState.FULL_ON_ROUTE,
            toState: ContainerState.WITH_CUSTOMER,
            locationId: LOCATION_ID,
          },
          USER_ID,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.containerMovement.create).not.toHaveBeenCalled();
    });

    it("a fleet entry (no origin) is created and never touches the customer balance", async () => {
      prisma.containerType.findUnique.mockResolvedValue(containerTypeRow());
      prisma.containerMovement.create.mockResolvedValue(movementRow());

      const result = await service.create(
        {
          type: ContainerMovementType.FLEET_ENTRY,
          containerTypeId: CONTAINER_TYPE_ID,
          quantity: 10,
          toState: ContainerState.EMPTY_AT_PLANT,
        },
        USER_ID,
      );

      expect(firstCallData(prisma.containerMovement.create)).toMatchObject({
        type: ContainerMovementType.FLEET_ENTRY,
        fromState: null,
        toState: ContainerState.EMPTY_AT_PLANT,
        quantity: 10,
        recordedById: USER_ID,
      });
      expect(prisma.customerContainerBalance.upsert).not.toHaveBeenCalled();
      expect(result.id).toBe(MOVEMENT_ID);
    });

    it("a loan delivery adds to a fresh (non-existent) customer balance", async () => {
      prisma.containerType.findUnique.mockResolvedValue(containerTypeRow());
      prisma.customerLocation.findUnique.mockResolvedValue(locationRow());
      prisma.customerContainerBalance.findUnique.mockResolvedValue(null);
      prisma.containerMovement.create.mockResolvedValue(
        movementRow({
          type: ContainerMovementType.LOAN_DELIVERY,
          fromState: ContainerState.FULL_ON_ROUTE,
          toState: ContainerState.WITH_CUSTOMER,
          locationId: LOCATION_ID,
          quantity: 6,
        }),
      );

      await service.create(
        {
          type: ContainerMovementType.LOAN_DELIVERY,
          containerTypeId: CONTAINER_TYPE_ID,
          quantity: 6,
          fromState: ContainerState.FULL_ON_ROUTE,
          toState: ContainerState.WITH_CUSTOMER,
          locationId: LOCATION_ID,
        },
        USER_ID,
      );

      const upsertArgs = firstCallArg<{
        create: { quantity: number };
        update: { quantity: number };
      }>(prisma.customerContainerBalance.upsert);
      expect(upsertArgs.create.quantity).toBe(6);
      expect(upsertArgs.update.quantity).toBe(6);
    });

    it("an empty pickup adds its negative delta on top of the existing customer balance", async () => {
      prisma.containerType.findUnique.mockResolvedValue(containerTypeRow());
      prisma.customerLocation.findUnique.mockResolvedValue(locationRow());
      prisma.customerContainerBalance.findUnique.mockResolvedValue({ quantity: 10 });
      prisma.containerMovement.create.mockResolvedValue(
        movementRow({
          type: ContainerMovementType.EMPTY_PICKUP,
          fromState: ContainerState.WITH_CUSTOMER,
          toState: ContainerState.EMPTY_ON_ROUTE,
          locationId: LOCATION_ID,
          quantity: 4,
        }),
      );

      await service.create(
        {
          type: ContainerMovementType.EMPTY_PICKUP,
          containerTypeId: CONTAINER_TYPE_ID,
          quantity: 4,
          fromState: ContainerState.WITH_CUSTOMER,
          toState: ContainerState.EMPTY_ON_ROUTE,
          locationId: LOCATION_ID,
        },
        USER_ID,
      );

      // 10 already on the books, minus this pickup's 4 — never the raw
      // -4 delta on its own, which is what an `increment` against the
      // wrong base would have produced.
      const upsertArgs = firstCallArg<{
        create: { quantity: number };
        update: { quantity: number };
      }>(prisma.customerContainerBalance.upsert);
      expect(upsertArgs.update.quantity).toBe(6);
    });

    it("rejects OPENING_BALANCE on the public route — it only enters through the roster loader", async () => {
      await expect(
        service.create(
          {
            type: ContainerMovementType.OPENING_BALANCE,
            containerTypeId: CONTAINER_TYPE_ID,
            quantity: 5,
            toState: ContainerState.WITH_CUSTOMER,
            locationId: LOCATION_ID,
          },
          USER_ID,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.containerType.findUnique).not.toHaveBeenCalled();
      expect(prisma.containerMovement.create).not.toHaveBeenCalled();
    });

    it("rejects COUNT_ADJUSTMENT on the public route — it only enters through ContainerCountsService", async () => {
      await expect(
        service.create(
          {
            type: ContainerMovementType.COUNT_ADJUSTMENT,
            containerTypeId: CONTAINER_TYPE_ID,
            quantity: 3,
            toState: ContainerState.WITH_CUSTOMER,
            locationId: LOCATION_ID,
          },
          USER_ID,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.containerType.findUnique).not.toHaveBeenCalled();
      expect(prisma.containerMovement.create).not.toHaveBeenCalled();
    });
  });

  describe("createWithinTransaction — occurredAt", () => {
    function fleetEntryDto() {
      return {
        type: ContainerMovementType.FLEET_ENTRY,
        containerTypeId: CONTAINER_TYPE_ID,
        quantity: 10,
        toState: ContainerState.EMPTY_AT_PLANT,
      } as const;
    }

    it("persists an explicit occurredAt as-is", async () => {
      prisma.containerType.findUnique.mockResolvedValue(containerTypeRow());
      prisma.containerMovement.create.mockResolvedValue(movementRow());
      const occurredAt = new Date("2026-01-15T05:00:00.000Z");

      await service.createWithinTransaction(
        prisma as unknown as Prisma.TransactionClient,
        fleetEntryDto(),
        USER_ID,
        { occurredAt },
      );

      expect(firstCallData(prisma.containerMovement.create).occurredAt).toBe(occurredAt);
    });

    it("defaults occurredAt to now when none is given", async () => {
      prisma.containerType.findUnique.mockResolvedValue(containerTypeRow());
      prisma.containerMovement.create.mockResolvedValue(movementRow());
      const before = Date.now();

      await service.createWithinTransaction(
        prisma as unknown as Prisma.TransactionClient,
        fleetEntryDto(),
        USER_ID,
      );

      const after = Date.now();
      const persisted = firstCallData(prisma.containerMovement.create).occurredAt as Date;
      expect(persisted.getTime()).toBeGreaterThanOrEqual(before);
      expect(persisted.getTime()).toBeLessThanOrEqual(after);
    });

    it("rejects a future occurredAt, without touching the database", async () => {
      const future = new Date(Date.now() + 60_000);

      await expect(
        service.createWithinTransaction(
          prisma as unknown as Prisma.TransactionClient,
          fleetEntryDto(),
          USER_ID,
          { occurredAt: future },
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.containerMovement.create).not.toHaveBeenCalled();
    });
  });

  describe("createWithinTransaction — OPENING_BALANCE", () => {
    it("increases the customer's container balance in the same transaction", async () => {
      prisma.containerType.findUnique.mockResolvedValue(containerTypeRow());
      prisma.customerLocation.findUnique.mockResolvedValue(locationRow());
      prisma.customerContainerBalance.findUnique.mockResolvedValue(null);
      prisma.containerMovement.create.mockResolvedValue(
        movementRow({
          type: ContainerMovementType.OPENING_BALANCE,
          fromState: null,
          toState: ContainerState.WITH_CUSTOMER,
          locationId: LOCATION_ID,
          quantity: 7,
        }),
      );

      await service.createWithinTransaction(
        prisma as unknown as Prisma.TransactionClient,
        {
          type: ContainerMovementType.OPENING_BALANCE,
          containerTypeId: CONTAINER_TYPE_ID,
          quantity: 7,
          toState: ContainerState.WITH_CUSTOMER,
          locationId: LOCATION_ID,
        },
        USER_ID,
        { occurredAt: new Date("2026-01-01T05:00:00.000Z") },
      );

      const upsertArgs = firstCallArg<{
        create: { quantity: number };
        update: { quantity: number };
      }>(prisma.customerContainerBalance.upsert);
      expect(upsertArgs.create.quantity).toBe(7);
      expect(upsertArgs.update.quantity).toBe(7);
    });
  });

  describe("findAll", () => {
    it("paginates and filters by type, container type, location and date range", async () => {
      prisma.containerMovement.count.mockResolvedValue(1);
      prisma.containerMovement.findMany.mockResolvedValue([movementRow()]);

      const result = await service.findAll({
        page: 1,
        limit: 20,
        type: ContainerMovementType.FLEET_ENTRY,
        containerTypeId: CONTAINER_TYPE_ID,
        locationId: LOCATION_ID,
        dateFrom: "2026-08-01",
        dateTo: "2026-08-31",
      });

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
      const findArgs = firstCallArg<{
        where: {
          type?: string;
          containerTypeId?: string;
          locationId?: string;
          occurredAt?: { gte?: Date; lt?: Date };
        };
      }>(prisma.containerMovement.findMany);
      expect(findArgs.where.type).toBe(ContainerMovementType.FLEET_ENTRY);
      expect(findArgs.where.containerTypeId).toBe(CONTAINER_TYPE_ID);
      expect(findArgs.where.locationId).toBe(LOCATION_ID);
      // Lima has no DST and sits at UTC-5: its midnight is 05:00 UTC.
      expect(findArgs.where.occurredAt?.gte?.toISOString()).toBe("2026-08-01T05:00:00.000Z");
      expect(findArgs.where.occurredAt?.lt?.toISOString()).toBe("2026-09-01T05:00:00.000Z");
    });

    it("rejects a from-date after the to-date", async () => {
      await expect(
        service.findAll({ page: 1, limit: 20, dateFrom: "2026-08-31", dateTo: "2026-08-01" }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("inventory", () => {
    it("derives net quantity per container type and state from the ledger, zero-filling untouched cells", async () => {
      prisma.containerType.findMany.mockResolvedValue([containerTypeRow()]);
      prisma.containerMovement.groupBy.mockImplementation((...args: unknown[]) => {
        const arg = args[0] as { by: string[] };
        if (arg.by.includes("toState")) {
          return Promise.resolve([
            {
              containerTypeId: CONTAINER_TYPE_ID,
              toState: ContainerState.EMPTY_AT_PLANT,
              _sum: { quantity: 10 },
            },
          ]);
        }
        return Promise.resolve([
          {
            containerTypeId: CONTAINER_TYPE_ID,
            fromState: ContainerState.EMPTY_AT_PLANT,
            _sum: { quantity: 3 },
          },
        ]);
      });

      const result = await service.inventory();

      const emptyAtPlant = result.find(
        (item) => item.containerTypeId === CONTAINER_TYPE_ID && item.state === "EMPTY_AT_PLANT",
      );
      expect(emptyAtPlant?.quantity).toBe(7);

      const untouched = result.find(
        (item) => item.containerTypeId === CONTAINER_TYPE_ID && item.state === "WITH_CUSTOMER",
      );
      expect(untouched?.quantity).toBe(0);

      // One row per (container type × state), regardless of ledger activity.
      expect(result).toHaveLength(Object.values(ContainerState).length);
    });
  });
});
