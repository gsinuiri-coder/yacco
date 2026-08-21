import { Test } from "@nestjs/testing";
import { Prisma, ProductType } from "@prisma/client";
import { jest } from "@jest/globals";
import { PrismaService } from "../../prisma/prisma.service.js";
import { ProductsService } from "./products.service.js";

const CONTAINER_TYPE_ID = "11111111-1111-4111-8111-111111111111";

function buildProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: "product-1",
    name: "Recarga 20L con caño",
    type: ProductType.REFILL,
    listPrice: new Prisma.Decimal("8.00"),
    active: true,
    containerType: { id: CONTAINER_TYPE_ID, name: "Con caño" },
    ...overrides,
  };
}

function buildPrismaMock() {
  return {
    product: { findMany: jest.fn<() => Promise<unknown>>() },
  };
}

describe("ProductsService", () => {
  let service: ProductsService;
  let prisma: ReturnType<typeof buildPrismaMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock();

    const moduleRef = await Test.createTestingModule({
      providers: [ProductsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(ProductsService);
  });

  it("returns listPrice as a 2-decimal string and the container type nested", async () => {
    prisma.product.findMany.mockResolvedValue([
      buildProduct({ listPrice: new Prisma.Decimal("8") }),
    ]);

    const result = await service.findAll({});

    expect(result).toHaveLength(1);
    expect(result[0]?.listPrice).toBe("8.00");
    expect(result[0]?.containerType).toEqual({ id: CONTAINER_TYPE_ID, name: "Con caño" });
  });

  it("defaults to active-only, so the order form never offers a withdrawn product", async () => {
    prisma.product.findMany.mockResolvedValue([]);

    await service.findAll({});

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true } }),
    );
  });

  it("passes an explicit active:false through instead of defaulting it", async () => {
    prisma.product.findMany.mockResolvedValue([]);

    await service.findAll({ active: false });

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: false } }),
    );
  });
});
