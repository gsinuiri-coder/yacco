import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Prisma } from "@prisma/client";
import type { Customer } from "@prisma/client";
import { jest } from "@jest/globals";
import { PrismaService } from "../../prisma/prisma.service.js";
import { CustomersService } from "./customers.service.js";
import { DEFAULT_LIMIT, DEFAULT_PAGE } from "./dto/list-customers-query.dto.js";

// Gherkin quoted from spec §2.4, HU-05:
// "Cuando registro un cliente con nombre, teléfono y dirección o referencia,
// entonces se crea con saldo de envases 0 y deuda S/ 0."

const ZONE_ID = "11111111-1111-4111-8111-111111111111";

function buildCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: "customer-1",
    zoneId: null,
    name: "Bodega Santa Rosa",
    phone: "987654321",
    address: "Av. Los Alamos 452",
    addressReference: "Porton azul frente al parque",
    creditLimit: null,
    debtBalance: new Prisma.Decimal(0),
    active: true,
    createdAt: new Date("2026-08-21T15:00:00.000Z"),
    ...overrides,
  };
}

/**
 * Reads the `data` payload the service handed Prisma. The mocks are declared
 * with no parameters (only their resolved value matters to the service), so
 * the recorded arguments are recovered through `unknown`.
 */
function firstCallData(mockFn: { mock: { calls: unknown[] } }): Record<string, unknown> {
  const args = mockFn.mock.calls[0] as [{ data: Record<string, unknown> }] | undefined;
  if (args === undefined) {
    throw new Error("expected the Prisma mock to have been called");
  }
  return args[0].data;
}

function buildPrismaMock() {
  return {
    customer: {
      create: jest.fn<() => Promise<unknown>>(),
      findMany: jest.fn<() => Promise<unknown>>(),
      findUnique: jest.fn<() => Promise<unknown>>(),
      count: jest.fn<() => Promise<unknown>>(),
      update: jest.fn<() => Promise<unknown>>(),
    },
    $transaction: jest.fn<(operations: Promise<unknown>[]) => Promise<unknown[]>>(),
  };
}

describe("CustomersService", () => {
  let service: CustomersService;
  let prisma: ReturnType<typeof buildPrismaMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock();
    // findAll batches count + findMany; the mock resolves the array it is given.
    prisma.$transaction.mockImplementation((operations) => Promise.all(operations));

    const moduleRef = await Test.createTestingModule({
      providers: [CustomersService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(CustomersService);
  });

  describe("create", () => {
    it("HU-05 E1: a new customer starts at debt S/ 0 and debtBalance is never written", async () => {
      prisma.customer.create.mockResolvedValue(buildCustomer());

      const result = await service.create({
        name: "Bodega Santa Rosa",
        phone: "987654321",
        address: "Av. Los Alamos 452",
        addressReference: "Porton azul frente al parque",
      });

      expect(firstCallData(prisma.customer.create)).not.toHaveProperty("debtBalance");
      expect(result.debtBalance).toBe("0.00");
      expect(result.creditLimit).toBeNull();
      expect(result.active).toBe(true);
    });

    it("stores creditLimit as an exact Decimal, never as a float", async () => {
      prisma.customer.create.mockResolvedValue(
        buildCustomer({ creditLimit: new Prisma.Decimal("150.55") }),
      );

      const result = await service.create({
        name: "Bodega Santa Rosa",
        phone: "987654321",
        address: "Av. Los Alamos 452",
        addressReference: "Porton azul frente al parque",
        creditLimit: "150.55",
      });

      const storedLimit = firstCallData(prisma.customer.create).creditLimit;
      expect(storedLimit).toBeInstanceOf(Prisma.Decimal);
      expect((storedLimit as Prisma.Decimal).toFixed(2)).toBe("150.55");
      expect(result.creditLimit).toBe("150.55");
    });

    it("forwards an explicit active flag, and omits it when the caller leaves it out", async () => {
      prisma.customer.create.mockResolvedValue(buildCustomer({ active: false }));

      await service.create({
        name: "Bodega Santa Rosa",
        phone: "987654321",
        address: "Av. Los Alamos 452",
        addressReference: "Porton azul frente al parque",
        active: false,
      });

      expect(firstCallData(prisma.customer.create)).toMatchObject({ active: false });
    });

    it("rejects an unknown zone with 400 instead of leaking the Prisma error", async () => {
      prisma.customer.create.mockRejectedValue(
        Object.assign(new Error("Foreign key constraint failed"), { code: "P2003" }),
      );

      await expect(
        service.create({
          name: "Sin zona",
          phone: "987654321",
          address: "Av. Los Alamos 452",
          addressReference: "Porton azul",
          zoneId: ZONE_ID,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rethrows an error it does not recognise", async () => {
      prisma.customer.create.mockRejectedValue(new Error("connection lost"));

      await expect(
        service.create({
          name: "Bodega Santa Rosa",
          phone: "987654321",
          address: "Av. Los Alamos 452",
          addressReference: "Porton azul",
        }),
      ).rejects.toThrow("connection lost");
    });
  });

  describe("findAll", () => {
    it("paginates: skip/take follow page and limit, and totalPages comes from the count", async () => {
      prisma.customer.count.mockResolvedValue(45);
      prisma.customer.findMany.mockResolvedValue([buildCustomer()]);

      const result = await service.findAll({ page: 3, limit: 20 });

      expect(prisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 40, take: 20, orderBy: { name: "asc" } }),
      );
      expect(result).toMatchObject({ total: 45, page: 3, limit: 20, totalPages: 3 });
      expect(result.data).toHaveLength(1);
    });

    it("searches name and phone, and counts against the same filter as the page", async () => {
      prisma.customer.count.mockResolvedValue(1);
      prisma.customer.findMany.mockResolvedValue([buildCustomer()]);

      await service.findAll({ page: DEFAULT_PAGE, limit: DEFAULT_LIMIT, search: "rosa" });

      const expectedWhere = {
        OR: [
          { name: { contains: "rosa", mode: Prisma.QueryMode.insensitive } },
          { phone: { contains: "rosa" } },
        ],
      };
      expect(prisma.customer.count).toHaveBeenCalledWith({ where: expectedWhere });
      expect(prisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expectedWhere }),
      );
    });

    it("filters by zone and by active", async () => {
      prisma.customer.count.mockResolvedValue(0);
      prisma.customer.findMany.mockResolvedValue([]);

      await service.findAll({
        page: DEFAULT_PAGE,
        limit: DEFAULT_LIMIT,
        zoneId: ZONE_ID,
        active: false,
      });

      expect(prisma.customer.count).toHaveBeenCalledWith({
        where: { zoneId: ZONE_ID, active: false },
      });
    });

    it("applies no filter when only pagination is given", async () => {
      prisma.customer.count.mockResolvedValue(0);
      prisma.customer.findMany.mockResolvedValue([]);

      const result = await service.findAll({ page: DEFAULT_PAGE, limit: DEFAULT_LIMIT });

      expect(prisma.customer.count).toHaveBeenCalledWith({ where: {} });
      expect(result.totalPages).toBe(0);
    });
  });

  describe("findOne", () => {
    it("exposes debtBalance and creditLimit as read-only 2-decimal strings", async () => {
      prisma.customer.findUnique.mockResolvedValue(
        buildCustomer({
          debtBalance: new Prisma.Decimal("40.5"),
          creditLimit: new Prisma.Decimal("200"),
        }),
      );

      const result = await service.findOne("customer-1");

      expect(result.debtBalance).toBe("40.50");
      expect(result.creditLimit).toBe("200.00");
    });

    it("throws NotFoundException for an unknown id", async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      await expect(service.findOne("missing")).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("update", () => {
    it("deactivates a customer with active:false instead of deleting the row", async () => {
      prisma.customer.update.mockResolvedValue(buildCustomer({ active: false }));

      const result = await service.update("customer-1", { active: false });

      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: "customer-1" },
        data: { active: false },
      });
      expect(result.active).toBe(false);
    });

    it("sends only the fields present in the patch, and never debtBalance", async () => {
      prisma.customer.update.mockResolvedValue(buildCustomer({ name: "Nuevo nombre" }));

      await service.update("customer-1", { name: "Nuevo nombre", creditLimit: "300.00" });

      const updateData = firstCallData(prisma.customer.update);
      expect(Object.keys(updateData).sort()).toEqual(["creditLimit", "name"]);
      expect(updateData).not.toHaveProperty("debtBalance");
      expect(updateData.creditLimit).toBeInstanceOf(Prisma.Decimal);
    });

    it("updates contact and location fields", async () => {
      prisma.customer.update.mockResolvedValue(buildCustomer({ phone: "912345678" }));

      await service.update("customer-1", {
        phone: "912345678",
        address: "Jr. Nuevo 100",
        addressReference: "Al lado del grifo",
        zoneId: ZONE_ID,
      });

      expect(firstCallData(prisma.customer.update)).toEqual({
        phone: "912345678",
        address: "Jr. Nuevo 100",
        addressReference: "Al lado del grifo",
        zoneId: ZONE_ID,
      });
    });

    it("throws NotFoundException for an unknown id", async () => {
      prisma.customer.update.mockRejectedValue(
        Object.assign(new Error("Record not found"), { code: "P2025" }),
      );

      await expect(service.update("missing", { active: false })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("throws BadRequestException when the patched zone does not exist", async () => {
      prisma.customer.update.mockRejectedValue(
        Object.assign(new Error("Foreign key constraint failed"), { code: "P2003" }),
      );

      await expect(service.update("customer-1", { zoneId: ZONE_ID })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("rethrows an error it does not recognise", async () => {
      prisma.customer.update.mockRejectedValue(new Error("connection lost"));

      await expect(service.update("customer-1", { active: false })).rejects.toThrow(
        "connection lost",
      );
    });
  });
});
