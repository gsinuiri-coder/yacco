import { NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { jest } from "@jest/globals";
import { PrismaService } from "../../prisma/prisma.service.js";
import { PaymentMethodsService } from "./payment-methods.service.js";

const PAYMENT_METHOD_ID = "11111111-1111-4111-8111-111111111111";

function buildPaymentMethod(overrides: Record<string, unknown> = {}) {
  return {
    id: PAYMENT_METHOD_ID,
    name: "Yape",
    active: true,
    requiresConfirmation: true,
    ...overrides,
  };
}

function buildPrismaMock() {
  return {
    paymentMethod: {
      findMany: jest.fn<() => Promise<unknown>>(),
      findUnique: jest.fn<() => Promise<unknown>>(),
    },
  };
}

describe("PaymentMethodsService", () => {
  let service: PaymentMethodsService;
  let prisma: ReturnType<typeof buildPrismaMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock();
    const moduleRef = await Test.createTestingModule({
      providers: [PaymentMethodsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(PaymentMethodsService);
  });

  describe("findAll", () => {
    it("defaults to active-only, so a collection form never offers a withdrawn method", async () => {
      prisma.paymentMethod.findMany.mockResolvedValue([]);

      await service.findAll({});

      expect(prisma.paymentMethod.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { active: true }, orderBy: { name: "asc" } }),
      );
    });

    it("passes an explicit active:false through instead of defaulting it", async () => {
      prisma.paymentMethod.findMany.mockResolvedValue([]);

      await service.findAll({ active: false });

      expect(prisma.paymentMethod.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { active: false } }),
      );
    });

    it("selects requiresConfirmation, so the collection screen can warn upfront", async () => {
      prisma.paymentMethod.findMany.mockResolvedValue([buildPaymentMethod()]);

      const result = await service.findAll({});

      expect(prisma.paymentMethod.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: { id: true, name: true, active: true, requiresConfirmation: true },
        }),
      );
      expect(result).toEqual([buildPaymentMethod()]);
    });
  });

  describe("findOne", () => {
    it("returns the row", async () => {
      prisma.paymentMethod.findUnique.mockResolvedValue(buildPaymentMethod());

      await expect(service.findOne(PAYMENT_METHOD_ID)).resolves.toEqual(buildPaymentMethod());
    });

    it("throws NotFound for an unknown id", async () => {
      prisma.paymentMethod.findUnique.mockResolvedValue(null);

      await expect(service.findOne(PAYMENT_METHOD_ID)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
