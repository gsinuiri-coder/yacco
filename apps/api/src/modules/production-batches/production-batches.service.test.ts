import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ContainerMovementType, ContainerState } from "@prisma/client";
import { jest } from "@jest/globals";
import { PrismaService } from "../../prisma/prisma.service.js";
import { ContainerMovementsService } from "../container-movements/container-movements.service.js";
import { ProductionBatchesService } from "./production-batches.service.js";

// Gherkin, spec HU-01: "Dado el responsable de planta, cuando registra el
// lote del día con sus líneas, entonces el sistema emite el movimiento
// FILLING de cada línea y descuenta los vacíos de planta correspondientes."

const CONTAINER_TYPE_A = "11111111-1111-4111-8111-111111111111";
const CONTAINER_TYPE_B = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const BATCH_ID = "44444444-4444-4444-8444-444444444444";

function containerType(overrides: Record<string, unknown> = {}) {
  return { id: CONTAINER_TYPE_A, name: "Con caño", active: true, ...overrides };
}

function batchRow(overrides: Record<string, unknown> = {}) {
  return {
    id: BATCH_ID,
    code: "LOTE-1",
    date: new Date(Date.UTC(2026, 7, 22)),
    filledById: USER_ID,
    filledBy: { id: USER_ID, name: "Responsable" },
    notes: null,
    items: [
      {
        id: "item-1",
        containerTypeId: CONTAINER_TYPE_A,
        containerType: { id: CONTAINER_TYPE_A, name: "Con caño" },
        producedQty: 50,
        availableQty: 50,
      },
    ],
    ...overrides,
  };
}

function buildPrismaMock() {
  return {
    productionBatch: {
      create: jest.fn<() => Promise<unknown>>(),
      count: jest.fn<() => Promise<unknown>>(),
      findMany: jest.fn<() => Promise<unknown>>(),
      findUnique: jest.fn<() => Promise<unknown>>(),
    },
    containerType: { findMany: jest.fn<() => Promise<unknown>>() },
    containerMovement: { aggregate: jest.fn<() => Promise<unknown>>() },
    $transaction: jest.fn<(arg: unknown) => Promise<unknown>>(),
  };
}

/** Every empty-at-plant lookup resolves to `available` unless overridden per type. */
function stubEmptyAtPlant(
  prisma: ReturnType<typeof buildPrismaMock>,
  available: number | Record<string, number>,
) {
  prisma.containerMovement.aggregate.mockImplementation((...args: unknown[]) => {
    const arg = args[0] as { where: { containerTypeId: string; toState?: unknown } };
    const quantity =
      typeof available === "number" ? available : (available[arg.where.containerTypeId] ?? 0);
    if (arg.where.toState !== undefined) {
      return Promise.resolve({ _sum: { quantity } });
    }
    return Promise.resolve({ _sum: { quantity: 0 } });
  });
}

function firstCallArg<T>(mockFn: { mock: { calls: unknown[] } }): T {
  const args = mockFn.mock.calls[0] as [T] | undefined;
  if (args === undefined) {
    throw new Error("expected the mock to have been called");
  }
  return args[0];
}

describe("ProductionBatchesService", () => {
  let service: ProductionBatchesService;
  let prisma: ReturnType<typeof buildPrismaMock>;
  let containerMovementsService: { createWithinTransaction: jest.Mock };

  beforeEach(async () => {
    prisma = buildPrismaMock();
    prisma.$transaction.mockImplementation((arg) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => Promise<unknown>)(prisma),
    );
    containerMovementsService = {
      createWithinTransaction: jest.fn<() => Promise<unknown>>().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ProductionBatchesService,
        { provide: PrismaService, useValue: prisma },
        { provide: ContainerMovementsService, useValue: containerMovementsService },
      ],
    }).compile();

    service = moduleRef.get(ProductionBatchesService);
  });

  describe("create", () => {
    it("un lote de dos líneas emite DOS movimientos FILLING con las cantidades correctas y el batchId del lote", async () => {
      prisma.containerType.findMany.mockResolvedValue([
        containerType(),
        containerType({ id: CONTAINER_TYPE_B, name: "Sin caño" }),
      ]);
      stubEmptyAtPlant(prisma, 1000);
      prisma.productionBatch.create.mockResolvedValue(
        batchRow({
          items: [
            batchRow().items[0],
            {
              id: "item-2",
              containerTypeId: CONTAINER_TYPE_B,
              containerType: { id: CONTAINER_TYPE_B, name: "Sin caño" },
              producedQty: 30,
              availableQty: 30,
            },
          ],
        }),
      );

      const result = await service.create(
        {
          code: "LOTE-1",
          date: "2026-08-22",
          items: [
            { containerTypeId: CONTAINER_TYPE_A, producedQty: 50 },
            { containerTypeId: CONTAINER_TYPE_B, producedQty: 30 },
          ],
        },
        USER_ID,
      );

      expect(containerMovementsService.createWithinTransaction).toHaveBeenCalledTimes(2);
      const [firstTx, firstDto, firstUser, firstOptions] =
        containerMovementsService.createWithinTransaction.mock.calls[0]!;
      expect(firstTx).toBe(prisma);
      expect(firstDto).toMatchObject({
        type: ContainerMovementType.FILLING,
        containerTypeId: CONTAINER_TYPE_A,
        quantity: 50,
        fromState: ContainerState.EMPTY_AT_PLANT,
        toState: ContainerState.FULL_AT_PLANT,
      });
      expect(firstUser).toBe(USER_ID);
      expect(firstOptions).toEqual({ batchId: BATCH_ID });

      const [, secondDto] = containerMovementsService.createWithinTransaction.mock.calls[1]!;
      expect(secondDto).toMatchObject({ containerTypeId: CONTAINER_TYPE_B, quantity: 30 });

      expect(result.warnings).toEqual([]);
      expect(result.id).toBe(BATCH_ID);
    });

    it("un código de lote duplicado da un error claro en español, no una violación cruda", async () => {
      prisma.containerType.findMany.mockResolvedValue([containerType()]);
      stubEmptyAtPlant(prisma, 1000);
      prisma.productionBatch.create.mockRejectedValue({ code: "P2002" });

      await expect(
        service.create(
          {
            code: "LOTE-1",
            date: "2026-08-22",
            items: [{ containerTypeId: CONTAINER_TYPE_A, producedQty: 10 }],
          },
          USER_ID,
        ),
      ).rejects.toThrow(ConflictException);
      expect(containerMovementsService.createWithinTransaction).not.toHaveBeenCalled();
    });

    it("un tipo de envase repetido en dos líneas es rechazado antes de tocar la base", async () => {
      await expect(
        service.create(
          {
            code: "LOTE-1",
            date: "2026-08-22",
            items: [
              { containerTypeId: CONTAINER_TYPE_A, producedQty: 10 },
              { containerTypeId: CONTAINER_TYPE_A, producedQty: 20 },
            ],
          },
          USER_ID,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.containerType.findMany).not.toHaveBeenCalled();
    });

    it("un tipo de envase que no existe es rechazado", async () => {
      prisma.containerType.findMany.mockResolvedValue([]);

      await expect(
        service.create(
          {
            code: "LOTE-1",
            date: "2026-08-22",
            items: [{ containerTypeId: CONTAINER_TYPE_A, producedQty: 10 }],
          },
          USER_ID,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.productionBatch.create).not.toHaveBeenCalled();
    });

    it("un tipo de envase inactivo es rechazado", async () => {
      prisma.containerType.findMany.mockResolvedValue([containerType({ active: false })]);

      await expect(
        service.create(
          {
            code: "LOTE-1",
            date: "2026-08-22",
            items: [{ containerTypeId: CONTAINER_TYPE_A, producedQty: 10 }],
          },
          USER_ID,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.productionBatch.create).not.toHaveBeenCalled();
    });

    // Business decision (spec, decided with the client): producing more than
    // the plant has empty is recorded anyway, never blocked — the owner
    // really filled those containers. The response names it so nobody
    // misses a negative that just silently sat in the inventory.
    it("producir más de los vacíos disponibles registra el lote igual y devuelve la advertencia con los números", async () => {
      prisma.containerType.findMany.mockResolvedValue([containerType()]);
      stubEmptyAtPlant(prisma, { [CONTAINER_TYPE_A]: 20 });
      prisma.productionBatch.create.mockResolvedValue(
        batchRow({ items: [{ ...batchRow().items[0], producedQty: 50, availableQty: 50 }] }),
      );

      const result = await service.create(
        {
          code: "LOTE-1",
          date: "2026-08-22",
          items: [{ containerTypeId: CONTAINER_TYPE_A, producedQty: 50 }],
        },
        USER_ID,
      );

      expect(containerMovementsService.createWithinTransaction).toHaveBeenCalledTimes(1);
      expect(result.warnings).toEqual([
        {
          containerTypeId: CONTAINER_TYPE_A,
          containerType: { id: CONTAINER_TYPE_A, name: "Con caño" },
          emptyAvailable: 20,
          produced: 50,
        },
      ]);
    });

    it("no advierte cuando lo producido no supera los vacíos disponibles", async () => {
      prisma.containerType.findMany.mockResolvedValue([containerType()]);
      stubEmptyAtPlant(prisma, { [CONTAINER_TYPE_A]: 100 });
      prisma.productionBatch.create.mockResolvedValue(batchRow());

      const result = await service.create(
        {
          code: "LOTE-1",
          date: "2026-08-22",
          items: [{ containerTypeId: CONTAINER_TYPE_A, producedQty: 50 }],
        },
        USER_ID,
      );

      expect(result.warnings).toEqual([]);
    });
  });

  describe("findAll", () => {
    it("pagina y filtra por rango de fechas", async () => {
      prisma.productionBatch.count.mockResolvedValue(1);
      prisma.productionBatch.findMany.mockResolvedValue([batchRow()]);

      const result = await service.findAll({
        page: 1,
        limit: 20,
        dateFrom: "2026-08-01",
        dateTo: "2026-08-31",
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.date).toBe("2026-08-22");
      const findArgs = firstCallArg<{ where: { date?: { gte?: Date; lte?: Date } } }>(
        prisma.productionBatch.findMany,
      );
      expect(findArgs.where.date?.gte?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
      expect(findArgs.where.date?.lte?.toISOString()).toBe("2026-08-31T00:00:00.000Z");
    });

    it("rechaza una fecha desde posterior a la fecha hasta", async () => {
      await expect(
        service.findAll({ page: 1, limit: 20, dateFrom: "2026-08-31", dateTo: "2026-08-01" }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("findOne", () => {
    it("devuelve el lote con sus líneas", async () => {
      prisma.productionBatch.findUnique.mockResolvedValue(batchRow());

      const result = await service.findOne(BATCH_ID);

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({ producedQty: 50, availableQty: 50 });
    });

    it("un id inexistente es rechazado con 404", async () => {
      prisma.productionBatch.findUnique.mockResolvedValue(null);

      await expect(service.findOne(BATCH_ID)).rejects.toThrow(NotFoundException);
    });
  });
});
