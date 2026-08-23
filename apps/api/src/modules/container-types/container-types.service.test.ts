import { Test } from "@nestjs/testing";
import { jest } from "@jest/globals";
import { PrismaService } from "../../prisma/prisma.service.js";
import { ContainerTypesService } from "./container-types.service.js";

function buildContainerType(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Con caño",
    active: true,
    ...overrides,
  };
}

function buildPrismaMock() {
  return {
    containerType: { findMany: jest.fn<() => Promise<unknown>>() },
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

  it("returns the catalog rows as-is", async () => {
    prisma.containerType.findMany.mockResolvedValue([buildContainerType()]);

    const result = await service.findAll({});

    expect(result).toEqual([
      { id: "11111111-1111-4111-8111-111111111111", name: "Con caño", active: true },
    ]);
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
