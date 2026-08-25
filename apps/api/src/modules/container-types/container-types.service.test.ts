import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { jest } from "@jest/globals";
import { PrismaService } from "../../prisma/prisma.service.js";
import { ContainerTypesService } from "./container-types.service.js";

const CONTAINER_TYPE_ID = "11111111-1111-4111-8111-111111111111";

function buildContainerType(overrides: Record<string, unknown> = {}) {
  return { id: CONTAINER_TYPE_ID, name: "Con caño", active: true, ...overrides };
}

function prismaError(code: string) {
  return Object.assign(new Error(`prisma ${code}`), { code });
}

function buildPrismaMock() {
  return {
    containerType: {
      create: jest.fn<() => Promise<unknown>>(),
      findMany: jest.fn<() => Promise<unknown>>(),
      findUnique: jest.fn<() => Promise<unknown>>(),
      update: jest.fn<() => Promise<unknown>>(),
    },
  };
}

describe("ContainerTypesService", () => {
  let service: ContainerTypesService;
  let prisma: ReturnType<typeof buildPrismaMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock();

    const moduleRef = await Test.createTestingModule({
      providers: [ContainerTypesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(ContainerTypesService);
  });

  describe("findAll", () => {
    it("returns the catalog rows as-is", async () => {
      prisma.containerType.findMany.mockResolvedValue([buildContainerType()]);

      const result = await service.findAll({});

      expect(result).toEqual([{ id: CONTAINER_TYPE_ID, name: "Con caño", active: true }]);
    });

    it("defaults to active-only, so a form never offers a withdrawn container type", async () => {
      prisma.containerType.findMany.mockResolvedValue([]);

      await service.findAll({});

      expect(prisma.containerType.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { active: true } }),
      );
    });

    it("passes an explicit active:false through instead of defaulting it", async () => {
      prisma.containerType.findMany.mockResolvedValue([]);

      await service.findAll({ active: false });

      expect(prisma.containerType.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { active: false } }),
      );
    });
  });

  describe("create", () => {
    it("creates the type active and returns the wire shape", async () => {
      prisma.containerType.create.mockResolvedValue(buildContainerType({ name: "Bidón (V)" }));

      const result = await service.create({ name: "Bidón (V)" });

      expect(prisma.containerType.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: { name: "Bidón (V)" } }),
      );
      expect(result).toEqual({ id: CONTAINER_TYPE_ID, name: "Bidón (V)", active: true });
    });

    it("translates a duplicate name (P2002) into a clear Spanish BadRequest", async () => {
      prisma.containerType.create.mockRejectedValue(prismaError("P2002"));

      await expect(service.create({ name: "Con caño" })).rejects.toThrow(
        new BadRequestException('Ya existe un tipo de envase con el nombre "Con caño"'),
      );
    });

    it("rethrows anything that is not a known unique violation", async () => {
      prisma.containerType.create.mockRejectedValue(new Error("connection lost"));

      await expect(service.create({ name: "Con caño" })).rejects.toThrow("connection lost");
    });
  });

  describe("findOne", () => {
    it("returns the row", async () => {
      prisma.containerType.findUnique.mockResolvedValue(buildContainerType());

      await expect(service.findOne(CONTAINER_TYPE_ID)).resolves.toEqual(buildContainerType());
    });

    it("throws NotFound for an unknown id", async () => {
      prisma.containerType.findUnique.mockResolvedValue(null);

      await expect(service.findOne(CONTAINER_TYPE_ID)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("update", () => {
    it("only sends the fields present in the body", async () => {
      prisma.containerType.update.mockResolvedValue(buildContainerType({ active: false }));

      await service.update(CONTAINER_TYPE_ID, { active: false });

      expect(prisma.containerType.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: CONTAINER_TYPE_ID }, data: { active: false } }),
      );
    });

    it("throws NotFound when Prisma reports the row missing (P2025)", async () => {
      prisma.containerType.update.mockRejectedValue(prismaError("P2025"));

      await expect(service.update(CONTAINER_TYPE_ID, { name: "X" })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("translates renaming onto an existing name (P2002) into a clear BadRequest", async () => {
      prisma.containerType.update.mockRejectedValue(prismaError("P2002"));

      await expect(service.update(CONTAINER_TYPE_ID, { name: "Sin caño" })).rejects.toThrow(
        new BadRequestException('Ya existe un tipo de envase con el nombre "Sin caño"'),
      );
    });
  });
});
