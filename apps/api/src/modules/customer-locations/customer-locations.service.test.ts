import { NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { jest } from "@jest/globals";
import { PrismaService } from "../../prisma/prisma.service.js";
import { CustomerLocationsService } from "./customer-locations.service.js";

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";

function buildLocation(overrides: Record<string, unknown> = {}) {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Principal",
    address: "Av. Los Alamos 452",
    addressReference: "Portón azul",
    phone: "987654321",
    isPrimary: true,
    active: true,
    ...overrides,
  };
}

function buildPrismaMock() {
  return {
    customer: { findUnique: jest.fn<() => Promise<unknown>>() },
    customerLocation: { findMany: jest.fn<() => Promise<unknown>>() },
  };
}

describe("CustomerLocationsService", () => {
  let service: CustomerLocationsService;
  let prisma: ReturnType<typeof buildPrismaMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock();

    const moduleRef = await Test.createTestingModule({
      providers: [CustomerLocationsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(CustomerLocationsService);
  });

  it("returns the customer's locations as-is", async () => {
    prisma.customer.findUnique.mockResolvedValue({ id: CUSTOMER_ID });
    prisma.customerLocation.findMany.mockResolvedValue([buildLocation()]);

    const result = await service.findAll(CUSTOMER_ID, {});

    expect(result).toEqual([buildLocation()]);
  });

  it("selects externalCode, read-only: the loader writes it, this route only reads it", async () => {
    prisma.customer.findUnique.mockResolvedValue({ id: CUSTOMER_ID });
    prisma.customerLocation.findMany.mockResolvedValue([]);

    await service.findAll(CUSTOMER_ID, {});

    expect(prisma.customerLocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ select: expect.objectContaining({ externalCode: true }) }),
    );
  });

  it("scopes the query to this customer and defaults to active-only", async () => {
    prisma.customer.findUnique.mockResolvedValue({ id: CUSTOMER_ID });
    prisma.customerLocation.findMany.mockResolvedValue([]);

    await service.findAll(CUSTOMER_ID, {});

    expect(prisma.customerLocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: CUSTOMER_ID, active: true } }),
    );
  });

  it("passes an explicit active:false through instead of defaulting it", async () => {
    prisma.customer.findUnique.mockResolvedValue({ id: CUSTOMER_ID });
    prisma.customerLocation.findMany.mockResolvedValue([]);

    await service.findAll(CUSTOMER_ID, { active: false });

    expect(prisma.customerLocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: CUSTOMER_ID, active: false } }),
    );
  });

  it("rejects a customer id that does not exist", async () => {
    prisma.customer.findUnique.mockResolvedValue(null);

    await expect(service.findAll(CUSTOMER_ID, {})).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.customerLocation.findMany).not.toHaveBeenCalled();
  });
});
