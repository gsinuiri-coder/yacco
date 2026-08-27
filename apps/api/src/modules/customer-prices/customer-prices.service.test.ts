import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Prisma } from "@prisma/client";
import { jest } from "@jest/globals";
import { PrismaService } from "../../prisma/prisma.service.js";
import { CustomerPricesService } from "./customer-prices.service.js";
import { PriceSource } from "./dto/effective-price-response.dto.js";

// Gherkin-style, spec HU-05/HU-08: "El precio efectivo de un producto para
// una ubicación se resuelve: precio de esa ubicación > precio del cliente (sin
// ubicación) > listPrice del producto. El acuerdo comercial es con el
// cliente; la ubicación es una excepción para esa sucursal."

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_CUSTOMER_ID = "99999999-9999-4999-8999-999999999999";
const PRODUCT_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_PRODUCT_ID = "88888888-8888-4888-8888-888888888888";
const LOCATION_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_LOCATION_ID = "44444444-4444-4444-8444-444444444444";
const PRICE_ID = "55555555-5555-4555-8555-555555555555";

function activeProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: PRODUCT_ID,
    name: "Recarga 20L",
    listPrice: new Prisma.Decimal("8.00"),
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

function customerPriceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PRICE_ID,
    customerId: CUSTOMER_ID,
    productId: PRODUCT_ID,
    locationId: null,
    price: new Prisma.Decimal("7.00"),
    ...overrides,
  };
}

function buildPrismaMock() {
  return {
    customer: { findUnique: jest.fn<() => Promise<unknown>>() },
    product: {
      findUnique: jest.fn<() => Promise<unknown>>(),
      findMany: jest.fn<() => Promise<unknown>>(),
    },
    customerLocation: { findUnique: jest.fn<() => Promise<unknown>>() },
    customerPrice: {
      findMany: jest.fn<(args: unknown) => Promise<unknown>>(),
      create: jest.fn<() => Promise<unknown>>(),
      updateMany: jest.fn<() => Promise<unknown>>(),
      deleteMany: jest.fn<() => Promise<unknown>>(),
      findUniqueOrThrow: jest.fn<() => Promise<unknown>>(),
    },
  };
}

describe("CustomerPricesService", () => {
  let service: CustomerPricesService;
  let prisma: ReturnType<typeof buildPrismaMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock();
    prisma.customer.findUnique.mockResolvedValue({ id: CUSTOMER_ID });
    prisma.product.findUnique.mockResolvedValue({ id: PRODUCT_ID });
    prisma.customerLocation.findUnique.mockResolvedValue({ customerId: CUSTOMER_ID });

    const moduleRef = await Test.createTestingModule({
      providers: [CustomerPricesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(CustomerPricesService);
  });

  describe("findAll", () => {
    it("lists a customer's agreed prices with product/location resolved", async () => {
      prisma.customerPrice.findMany.mockResolvedValue([
        {
          ...customerPriceRow(),
          product: { id: PRODUCT_ID, name: "Recarga 20L" },
          location: null,
        },
      ]);

      const result = await service.findAll(CUSTOMER_ID);

      expect(result).toEqual([
        {
          id: PRICE_ID,
          product: { id: PRODUCT_ID, name: "Recarga 20L" },
          location: null,
          price: "7.00",
        },
      ]);
      expect(prisma.customerPrice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { customerId: CUSTOMER_ID } }),
      );
    });

    it("throws NotFoundException for an unknown customer", async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      await expect(service.findAll(CUSTOMER_ID)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("create", () => {
    it("creates a customer-wide price (no location) as an exact Decimal", async () => {
      prisma.customerPrice.create.mockResolvedValue({
        ...customerPriceRow(),
        product: { id: PRODUCT_ID, name: "Recarga 20L" },
        location: null,
      });

      const result = await service.create(CUSTOMER_ID, { productId: PRODUCT_ID, price: "7.00" });

      expect(prisma.customerPrice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customerId: CUSTOMER_ID,
            productId: PRODUCT_ID,
            locationId: null,
          }),
        }),
      );
      const sentPrice = firstCallData(prisma.customerPrice.create).price;
      expect(sentPrice).toBeInstanceOf(Prisma.Decimal);
      expect(result.price).toBe("7.00");
      expect(result.location).toBeNull();
    });

    it("creates a location override once the location is confirmed to belong to the customer", async () => {
      prisma.customerPrice.create.mockResolvedValue({
        ...customerPriceRow({ locationId: LOCATION_ID }),
        product: { id: PRODUCT_ID, name: "Recarga 20L" },
        location: { id: LOCATION_ID, name: "Sucursal Norte" },
      });

      const result = await service.create(CUSTOMER_ID, {
        productId: PRODUCT_ID,
        locationId: LOCATION_ID,
        price: "6.50",
      });

      expect(prisma.customerLocation.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: LOCATION_ID } }),
      );
      expect(result.location).toEqual({ id: LOCATION_ID, name: "Sucursal Norte" });
    });

    it("rejects a location that belongs to a different customer, with 400 not 500", async () => {
      prisma.customerLocation.findUnique.mockResolvedValue({ customerId: OTHER_CUSTOMER_ID });

      await expect(
        service.create(CUSTOMER_ID, {
          productId: PRODUCT_ID,
          locationId: LOCATION_ID,
          price: "6.50",
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.customerPrice.create).not.toHaveBeenCalled();
    });

    it("rejects a location that does not exist at all", async () => {
      prisma.customerLocation.findUnique.mockResolvedValue(null);

      await expect(
        service.create(CUSTOMER_ID, {
          productId: PRODUCT_ID,
          locationId: LOCATION_ID,
          price: "6.50",
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.customerPrice.create).not.toHaveBeenCalled();
    });

    it("rejects a product that does not exist", async () => {
      prisma.product.findUnique.mockResolvedValue(null);

      await expect(
        service.create(CUSTOMER_ID, { productId: PRODUCT_ID, price: "6.50" }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.customerPrice.create).not.toHaveBeenCalled();
    });

    it("rejects an unknown customer before touching product/location", async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      await expect(
        service.create(CUSTOMER_ID, { productId: PRODUCT_ID, price: "6.50" }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.product.findUnique).not.toHaveBeenCalled();
      expect(prisma.customerPrice.create).not.toHaveBeenCalled();
    });

    it("turns a duplicate customer-wide price into a clear 409, not a raw constraint error", async () => {
      prisma.customerPrice.create.mockRejectedValue(
        Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
      );

      const attempt = service.create(CUSTOMER_ID, { productId: PRODUCT_ID, price: "6.50" });

      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      await expect(attempt).rejects.toThrow("cliente y este producto");
    });

    it("turns a duplicate location price into a clear 409 naming the location tier", async () => {
      prisma.customerPrice.create.mockRejectedValue(
        Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
      );

      const attempt = service.create(CUSTOMER_ID, {
        productId: PRODUCT_ID,
        locationId: LOCATION_ID,
        price: "6.50",
      });

      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      await expect(attempt).rejects.toThrow("ubicación");
    });
  });

  describe("update", () => {
    it("updates the price and returns the row re-fetched", async () => {
      prisma.customerPrice.updateMany.mockResolvedValue({ count: 1 });
      prisma.customerPrice.findUniqueOrThrow.mockResolvedValue({
        ...customerPriceRow({ price: new Prisma.Decimal("5.00") }),
        product: { id: PRODUCT_ID, name: "Recarga 20L" },
        location: null,
      });

      const result = await service.update(CUSTOMER_ID, PRICE_ID, { price: "5.00" });

      expect(prisma.customerPrice.updateMany).toHaveBeenCalledWith({
        where: { id: PRICE_ID, customerId: CUSTOMER_ID },
        data: { price: expect.any(Prisma.Decimal) },
      });
      expect(result.price).toBe("5.00");
    });

    it("throws NotFoundException when the price does not exist for this customer", async () => {
      prisma.customerPrice.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.update(CUSTOMER_ID, PRICE_ID, { price: "5.00" })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("remove", () => {
    it("deletes, scoped to this customer", async () => {
      prisma.customerPrice.deleteMany.mockResolvedValue({ count: 1 });

      await service.remove(CUSTOMER_ID, PRICE_ID);

      expect(prisma.customerPrice.deleteMany).toHaveBeenCalledWith({
        where: { id: PRICE_ID, customerId: CUSTOMER_ID },
      });
    });

    it("throws NotFoundException when nothing was deleted", async () => {
      prisma.customerPrice.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.remove(CUSTOMER_ID, PRICE_ID)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("findEffectivePrices — precedence", () => {
    it("without any agreed price, the effective price is listPrice, source LIST", async () => {
      prisma.product.findMany.mockResolvedValue([activeProduct()]);
      prisma.customerPrice.findMany.mockResolvedValue([]);

      const result = await service.findEffectivePrices(CUSTOMER_ID, {});

      expect(result).toEqual([
        {
          product: { id: PRODUCT_ID, name: "Recarga 20L" },
          price: "8.00",
          source: PriceSource.LIST,
        },
      ]);
    });

    it("a customer-wide price wins over listPrice, for every one of its locations", async () => {
      prisma.product.findMany.mockResolvedValue([activeProduct()]);
      prisma.customerPrice.findMany.mockResolvedValue([
        customerPriceRow({ price: new Prisma.Decimal("7.00") }),
      ]);

      const withoutLocation = await service.findEffectivePrices(CUSTOMER_ID, {});
      expect(withoutLocation[0]).toMatchObject({ price: "7.00", source: PriceSource.CUSTOMER });

      const withLocation = await service.findEffectivePrices(CUSTOMER_ID, {
        locationId: LOCATION_ID,
      });
      expect(withLocation[0]).toMatchObject({ price: "7.00", source: PriceSource.CUSTOMER });
    });

    it("a location price wins over the customer price in ITS location; another location of the same customer still gets the customer price", async () => {
      prisma.product.findMany.mockResolvedValue([activeProduct()]);
      // Both tiers exist for this product: customer-wide 7.00, and a 6.50
      // override just for LOCATION_ID.
      prisma.customerPrice.findMany.mockImplementation((args: unknown) => {
        const where = (args as { where: { OR: { locationId: string | null }[] } }).where;
        const queriedLocationId = where.OR.find((clause) => clause.locationId !== null)?.locationId;
        const rows = [customerPriceRow({ price: new Prisma.Decimal("7.00") })];
        if (queriedLocationId === LOCATION_ID) {
          rows.push(
            customerPriceRow({
              id: "66666666-6666-4666-8666-666666666666",
              locationId: LOCATION_ID,
              price: new Prisma.Decimal("6.50"),
            }),
          );
        }
        return Promise.resolve(rows);
      });

      const atOverriddenLocation = await service.findEffectivePrices(CUSTOMER_ID, {
        locationId: LOCATION_ID,
      });
      expect(atOverriddenLocation[0]).toMatchObject({
        price: "6.50",
        source: PriceSource.LOCATION,
      });

      const atOtherLocation = await service.findEffectivePrices(CUSTOMER_ID, {
        locationId: OTHER_LOCATION_ID,
      });
      expect(atOtherLocation[0]).toMatchObject({ price: "7.00", source: PriceSource.CUSTOMER });
    });

    it("resolves each active product independently", async () => {
      prisma.product.findMany.mockResolvedValue([
        activeProduct(),
        activeProduct({
          id: OTHER_PRODUCT_ID,
          name: "Bidón 20L",
          listPrice: new Prisma.Decimal("30.00"),
        }),
      ]);
      prisma.customerPrice.findMany.mockResolvedValue([customerPriceRow()]);

      const result = await service.findEffectivePrices(CUSTOMER_ID, {});

      expect(result).toEqual([
        {
          product: { id: PRODUCT_ID, name: "Recarga 20L" },
          price: "7.00",
          source: PriceSource.CUSTOMER,
        },
        {
          product: { id: OTHER_PRODUCT_ID, name: "Bidón 20L" },
          price: "30.00",
          source: PriceSource.LIST,
        },
      ]);
    });

    it("throws NotFoundException for an unknown customer", async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      await expect(service.findEffectivePrices(CUSTOMER_ID, {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("rejects a location that does not belong to this customer", async () => {
      prisma.customerLocation.findUnique.mockResolvedValue({ customerId: OTHER_CUSTOMER_ID });

      await expect(
        service.findEffectivePrices(CUSTOMER_ID, { locationId: LOCATION_ID }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
