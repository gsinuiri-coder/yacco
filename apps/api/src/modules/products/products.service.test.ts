import { Test } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
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
    product: {
      findMany: jest.fn<() => Promise<unknown>>(),
      update: jest.fn<() => Promise<unknown>>(),
    },
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

  describe("update", () => {
    it("writes the list price as a Decimal and answers it as a 2-decimal string", async () => {
      prisma.product.update.mockResolvedValue(
        buildProduct({ listPrice: new Prisma.Decimal("9.5") }),
      );

      const result = await service.update("product-1", { listPrice: "9.5" });

      expect(prisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "product-1" },
          data: { listPrice: new Prisma.Decimal("9.5") },
        }),
      );
      expect(result.listPrice).toBe("9.50");
    });

    it("turns an unknown id (P2025) into a 404", async () => {
      prisma.product.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("not found", {
          code: "P2025",
          clientVersion: "test",
        }),
      );

      await expect(service.update("missing", { listPrice: "1.00" })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("lets any other error through", async () => {
      prisma.product.update.mockRejectedValue(new Error("boom"));

      await expect(service.update("product-1", { listPrice: "1.00" })).rejects.toThrow("boom");
    });
  });
});
