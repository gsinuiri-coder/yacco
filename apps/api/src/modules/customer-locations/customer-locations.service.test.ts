import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { jest } from "@jest/globals";
import { PrismaService } from "../../prisma/prisma.service.js";
import { CustomerLocationsService } from "./customer-locations.service.js";

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";
const LOCATION_ID = "22222222-2222-4222-8222-222222222222";

function buildLocation(overrides: Record<string, unknown> = {}) {
  return {
    id: LOCATION_ID,
    name: "Principal",
    address: "Av. Los Alamos 452",
    addressReference: "Portón azul",
    phone: "987654321",
    contactName: null,
    latitude: null,
    longitude: null,
    isPrimary: true,
    active: true,
    ...overrides,
  };
}

function buildPrismaMock() {
  return {
    customer: { findUnique: jest.fn<() => Promise<unknown>>() },
    customerLocation: {
      findMany: jest.fn<() => Promise<unknown>>(),
      updateMany: jest.fn<() => Promise<unknown>>(),
      findFirstOrThrow: jest.fn<() => Promise<unknown>>(),
    },
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

  it("selects the contact and coordinates needed by the customer record and route", async () => {
    prisma.customer.findUnique.mockResolvedValue({ id: CUSTOMER_ID });
    prisma.customerLocation.findMany.mockResolvedValue([]);

    await service.findAll(CUSTOMER_ID, {});

    expect(prisma.customerLocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          contactName: true,
          latitude: true,
          longitude: true,
        }),
      }),
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

  it("updates a location scoped to its customer and normalizes the contact", async () => {
    prisma.customerLocation.updateMany.mockResolvedValue({ count: 1 });
    prisma.customerLocation.findFirstOrThrow.mockResolvedValue(
      buildLocation({
        contactName: "Rosa Quispe",
        latitude: { toFixed: () => "-12.046374" },
        longitude: { toFixed: () => "-77.042793" },
      }),
    );

    const result = await service.update(CUSTOMER_ID, LOCATION_ID, {
      contactName: "  Rosa Quispe  ",
      latitude: "-12.046374",
      longitude: "-77.042793",
    });

    expect(prisma.customerLocation.updateMany).toHaveBeenCalledWith({
      where: { id: LOCATION_ID, customerId: CUSTOMER_ID },
      data: {
        contactName: "Rosa Quispe",
        latitude: expect.objectContaining({ toString: expect.any(Function) }),
        longitude: expect.objectContaining({ toString: expect.any(Function) }),
      },
    });
    expect(result).toMatchObject({
      contactName: "Rosa Quispe",
      latitude: "-12.046374",
      longitude: "-77.042793",
    });
  });

  it("rejects a location that does not belong to the customer", async () => {
    prisma.customerLocation.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.update(CUSTOMER_ID, LOCATION_ID, {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.customerLocation.findFirstOrThrow).not.toHaveBeenCalled();
  });

  it("resolves only allowlisted Google Maps short links", async () => {
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: {
          location: "https://www.google.com/maps/place/Local/data=!3d-12.046374!4d-77.042793",
        },
      }),
    );

    await expect(service.resolveGoogleMapsLink("https://maps.app.goo.gl/AbC123")).resolves.toEqual({
      url: "https://www.google.com/maps/place/Local/data=!3d-12.046374!4d-77.042793",
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://maps.app.goo.gl/AbC123",
      expect.objectContaining({ redirect: "manual" }),
    );
    fetchSpy.mockRestore();

    await expect(
      service.resolveGoogleMapsLink("https://example.com/private"),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
