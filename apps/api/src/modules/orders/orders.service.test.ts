import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { OrderStatus, Prisma } from "@prisma/client";
import { jest } from "@jest/globals";
import { PrismaService } from "../../prisma/prisma.service.js";
import { OrdersService, formatBusinessDate, parseBusinessDate } from "./orders.service.js";
import { DEFAULT_LIMIT, DEFAULT_PAGE } from "./dto/list-orders-query.dto.js";

// Gherkin quoted from spec §2.4, HU-06:
// "Dado un cliente registrado, cuando capturo un pedido, entonces queda en
// estado «pendiente», disponible para asignar a una ruta, con precios según
// lista o personalizado."

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCT_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_PRODUCT_ID = "33333333-3333-4333-8333-333333333333";
const ORDER_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "55555555-5555-4555-8555-555555555555";

function buildOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    customerId: CUSTOMER_ID,
    deliveryDate: new Date(Date.UTC(2026, 7, 25)),
    status: OrderStatus.PENDING,
    createdById: USER_ID,
    createdAt: new Date("2026-08-21T15:00:00.000Z"),
    customer: { id: CUSTOMER_ID, name: "Bodega Santa Rosa", phone: "987654321" },
    items: [
      {
        id: "item-1",
        productId: PRODUCT_ID,
        product: { id: PRODUCT_ID, name: "Recarga 20L" },
        quantity: 3,
        unitPrice: new Prisma.Decimal("12.5"),
      },
    ],
    ...overrides,
  };
}

function validItems() {
  return [{ productId: PRODUCT_ID, quantity: 3, unitPrice: "12.50" }];
}

// create() selects `active` on both, so the shapes the mock returns have to
// carry it — an undefined `active` would read as deactivated.
function activeCustomer(overrides: Record<string, unknown> = {}) {
  return { id: CUSTOMER_ID, name: "Bodega Santa Rosa", active: true, ...overrides };
}

function activeProduct(overrides: Record<string, unknown> = {}) {
  return { id: PRODUCT_ID, name: "Recarga 20L", active: true, ...overrides };
}

function firstCallArgs(mockFn: { mock: { calls: unknown[] } }): Record<string, unknown> {
  const args = mockFn.mock.calls[0] as [Record<string, unknown>] | undefined;
  if (args === undefined) {
    throw new Error("expected the Prisma mock to have been called");
  }
  return args[0];
}

function buildPrismaMock() {
  return {
    order: {
      create: jest.fn<() => Promise<unknown>>(),
      findMany: jest.fn<() => Promise<unknown>>(),
      findUnique: jest.fn<() => Promise<unknown>>(),
      count: jest.fn<() => Promise<unknown>>(),
      updateMany: jest.fn<() => Promise<unknown>>(),
    },
    customer: { findUnique: jest.fn<() => Promise<unknown>>() },
    product: { findMany: jest.fn<() => Promise<unknown>>() },
    $transaction: jest.fn<(arg: unknown) => Promise<unknown>>(),
  };
}

describe("OrdersService", () => {
  let service: OrdersService;
  let prisma: ReturnType<typeof buildPrismaMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock();
    // create() passes a callback; findAll() passes an array of operations.
    prisma.$transaction.mockImplementation((arg) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => Promise<unknown>)(prisma),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [OrdersService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(OrdersService);
  });

  describe("business dates", () => {
    it("reads and writes a calendar day in UTC, so the server timezone cannot shift it", () => {
      const parsed = parseBusinessDate("2026-08-25", "La fecha");

      expect(parsed.toISOString()).toBe("2026-08-25T00:00:00.000Z");
      expect(formatBusinessDate(parsed)).toBe("2026-08-25");
    });

    it("rejects a well-formed but impossible calendar day", () => {
      expect(() => parseBusinessDate("2026-02-31", "La fecha de entrega")).toThrow(
        BadRequestException,
      );
    });

    it("accepts a leap day that really exists", () => {
      expect(formatBusinessDate(parseBusinessDate("2028-02-29", "La fecha"))).toBe("2028-02-29");
    });
  });

  describe("create", () => {
    it("HU-06 E1: a captured order is born PENDING with its items", async () => {
      prisma.customer.findUnique.mockResolvedValue(activeCustomer());
      prisma.product.findMany.mockResolvedValue([activeProduct()]);
      prisma.order.create.mockResolvedValue(buildOrder());

      const result = await service.create(
        { customerId: CUSTOMER_ID, deliveryDate: "2026-08-25", items: validItems() },
        USER_ID,
      );

      const createArgs = firstCallArgs(prisma.order.create) as {
        data: Record<string, unknown>;
      };
      // Status is never sent: the column default is what makes it PENDING.
      expect(createArgs.data).not.toHaveProperty("status");
      expect(createArgs.data.createdById).toBe(USER_ID);
      expect(result.status).toBe(OrderStatus.PENDING);
      expect(result.deliveryDate).toBe("2026-08-25");
      expect(result.items).toHaveLength(1);
    });

    it("persists unitPrice as an exact Decimal and returns it as a 2-decimal string", async () => {
      prisma.customer.findUnique.mockResolvedValue(activeCustomer());
      prisma.product.findMany.mockResolvedValue([activeProduct()]);
      prisma.order.create.mockResolvedValue(buildOrder());

      const result = await service.create(
        { customerId: CUSTOMER_ID, deliveryDate: "2026-08-25", items: validItems() },
        USER_ID,
      );

      const createArgs = firstCallArgs(prisma.order.create) as {
        data: { items: { create: { unitPrice: Prisma.Decimal }[] } };
      };
      const sentPrice = createArgs.data.items.create[0]?.unitPrice;
      expect(sentPrice).toBeInstanceOf(Prisma.Decimal);
      expect(sentPrice?.toFixed(2)).toBe("12.50");
      // "12.5" in the DB still reaches the client as "12.50".
      expect(result.items[0]?.unitPrice).toBe("12.50");
    });

    it("rejects an unknown customer before inserting anything", async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      await expect(
        service.create(
          { customerId: CUSTOMER_ID, deliveryDate: "2026-08-25", items: validItems() },
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it("refuses to take an order for a deactivated customer, saying so", async () => {
      prisma.customer.findUnique.mockResolvedValue(activeCustomer({ active: false }));

      await expect(
        service.create(
          { customerId: CUSTOMER_ID, deliveryDate: "2026-08-25", items: validItems() },
          USER_ID,
        ),
      ).rejects.toThrow("desactivado");
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it("refuses a product that is no longer on sale, naming it", async () => {
      prisma.customer.findUnique.mockResolvedValue(activeCustomer());
      prisma.product.findMany.mockResolvedValue([
        activeProduct({ name: "Recarga descontinuada", active: false }),
      ]);

      const attempt = service.create(
        { customerId: CUSTOMER_ID, deliveryDate: "2026-08-25", items: validItems() },
        USER_ID,
      );

      await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it("names every inactive product, not just the first", async () => {
      prisma.customer.findUnique.mockResolvedValue(activeCustomer());
      prisma.product.findMany.mockResolvedValue([
        activeProduct({ name: "Recarga vieja", active: false }),
        activeProduct({ id: OTHER_PRODUCT_ID, name: "Bidón retirado", active: false }),
      ]);

      const attempt = service.create(
        {
          customerId: CUSTOMER_ID,
          deliveryDate: "2026-08-25",
          items: [
            { productId: PRODUCT_ID, quantity: 1, unitPrice: "10.00" },
            { productId: OTHER_PRODUCT_ID, quantity: 1, unitPrice: "20.00" },
          ],
        },
        USER_ID,
      );

      await expect(attempt).rejects.toThrow("Recarga vieja");
      await expect(
        service.create(
          {
            customerId: CUSTOMER_ID,
            deliveryDate: "2026-08-25",
            items: [
              { productId: PRODUCT_ID, quantity: 1, unitPrice: "10.00" },
              { productId: OTHER_PRODUCT_ID, quantity: 1, unitPrice: "20.00" },
            ],
          },
          USER_ID,
        ),
      ).rejects.toThrow("Bidón retirado");
    });

    it("names the products that do not exist instead of failing on the foreign key", async () => {
      prisma.customer.findUnique.mockResolvedValue(activeCustomer());
      prisma.product.findMany.mockResolvedValue([activeProduct()]);

      await expect(
        service.create(
          {
            customerId: CUSTOMER_ID,
            deliveryDate: "2026-08-25",
            items: [
              { productId: PRODUCT_ID, quantity: 1, unitPrice: "10.00" },
              { productId: OTHER_PRODUCT_ID, quantity: 2, unitPrice: "20.00" },
            ],
          },
          USER_ID,
        ),
      ).rejects.toThrow(OTHER_PRODUCT_ID);
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it("looks each product up once even when it repeats across items", async () => {
      prisma.customer.findUnique.mockResolvedValue(activeCustomer());
      prisma.product.findMany.mockResolvedValue([activeProduct()]);
      prisma.order.create.mockResolvedValue(buildOrder());

      await service.create(
        {
          customerId: CUSTOMER_ID,
          deliveryDate: "2026-08-25",
          items: [
            { productId: PRODUCT_ID, quantity: 1, unitPrice: "10.00" },
            { productId: PRODUCT_ID, quantity: 2, unitPrice: "10.00" },
          ],
        },
        USER_ID,
      );

      expect(prisma.product.findMany).toHaveBeenCalledWith({
        where: { id: { in: [PRODUCT_ID] } },
        select: { id: true, name: true, active: true },
      });
    });

    it("rejects an impossible delivery date before touching the database", async () => {
      await expect(
        service.create(
          { customerId: CUSTOMER_ID, deliveryDate: "2026-02-31", items: validItems() },
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.customer.findUnique).not.toHaveBeenCalled();
    });
  });

  describe("findAll", () => {
    it("paginates: skip/take follow page and limit, and totalPages comes from the count", async () => {
      prisma.order.count.mockResolvedValue(45);
      prisma.order.findMany.mockResolvedValue([buildOrder()]);

      const result = await service.findAll({ page: 3, limit: 20 });

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 40, take: 20 }),
      );
      expect(result).toMatchObject({ total: 45, page: 3, limit: 20, totalPages: 3 });
    });

    it("filters by status and customer, counting against the same filter", async () => {
      prisma.order.count.mockResolvedValue(1);
      prisma.order.findMany.mockResolvedValue([buildOrder()]);

      await service.findAll({
        page: DEFAULT_PAGE,
        limit: DEFAULT_LIMIT,
        status: OrderStatus.PENDING,
        customerId: CUSTOMER_ID,
      });

      expect(prisma.order.count).toHaveBeenCalledWith({
        where: { status: OrderStatus.PENDING, customerId: CUSTOMER_ID },
      });
    });

    it("filters an inclusive delivery-date range", async () => {
      prisma.order.count.mockResolvedValue(0);
      prisma.order.findMany.mockResolvedValue([]);

      await service.findAll({
        page: DEFAULT_PAGE,
        limit: DEFAULT_LIMIT,
        deliveryDateFrom: "2026-08-01",
        deliveryDateTo: "2026-08-31",
      });

      expect(prisma.order.count).toHaveBeenCalledWith({
        where: {
          deliveryDate: {
            gte: new Date(Date.UTC(2026, 7, 1)),
            lte: new Date(Date.UTC(2026, 7, 31)),
          },
        },
      });
    });

    it("accepts an open-ended range", async () => {
      prisma.order.count.mockResolvedValue(0);
      prisma.order.findMany.mockResolvedValue([]);

      await service.findAll({
        page: DEFAULT_PAGE,
        limit: DEFAULT_LIMIT,
        deliveryDateFrom: "2026-08-01",
      });

      expect(prisma.order.count).toHaveBeenCalledWith({
        where: { deliveryDate: { gte: new Date(Date.UTC(2026, 7, 1)) } },
      });
    });

    it("rejects an inverted date range", async () => {
      await expect(
        service.findAll({
          page: DEFAULT_PAGE,
          limit: DEFAULT_LIMIT,
          deliveryDateFrom: "2026-08-31",
          deliveryDateTo: "2026-08-01",
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("applies no filter when only pagination is given", async () => {
      prisma.order.count.mockResolvedValue(0);
      prisma.order.findMany.mockResolvedValue([]);

      const result = await service.findAll({ page: DEFAULT_PAGE, limit: DEFAULT_LIMIT });

      expect(prisma.order.count).toHaveBeenCalledWith({ where: {} });
      expect(result.totalPages).toBe(0);
    });
  });

  describe("findOne", () => {
    it("returns the order with its items", async () => {
      prisma.order.findUnique.mockResolvedValue(buildOrder());

      const result = await service.findOne(ORDER_ID);

      expect(result.id).toBe(ORDER_ID);
      expect(result.customer.name).toBe("Bodega Santa Rosa");
      expect(result.items[0]?.product.name).toBe("Recarga 20L");
    });

    it("throws NotFoundException for an unknown id", async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(service.findOne(ORDER_ID)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("cancel", () => {
    it("cancels a PENDING order, guarding the status inside the WHERE clause", async () => {
      prisma.order.updateMany.mockResolvedValue({ count: 1 });
      prisma.order.findUnique.mockResolvedValue(buildOrder({ status: OrderStatus.CANCELLED }));

      const result = await service.cancel(ORDER_ID);

      expect(prisma.order.updateMany).toHaveBeenCalledWith({
        where: { id: ORDER_ID, status: OrderStatus.PENDING },
        data: { status: OrderStatus.CANCELLED },
      });
      expect(result.status).toBe(OrderStatus.CANCELLED);
    });

    it("refuses to cancel an order a route already picked up", async () => {
      prisma.order.updateMany.mockResolvedValue({ count: 0 });
      prisma.order.findUnique.mockResolvedValue({ status: OrderStatus.ON_ROUTE });

      await expect(service.cancel(ORDER_ID)).rejects.toBeInstanceOf(ConflictException);
      await expect(service.cancel(ORDER_ID)).rejects.toThrow(OrderStatus.ON_ROUTE);
    });

    it("throws NotFoundException when the order does not exist at all", async () => {
      prisma.order.updateMany.mockResolvedValue({ count: 0 });
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(service.cancel(ORDER_ID)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
