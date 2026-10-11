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
const LOCATION_ID = "66666666-6666-4666-8666-666666666666";
const OTHER_LOCATION_ID = "77777777-7777-4777-8777-777777777777";
const ORDER_GROUP_ID = "88888888-8888-4888-8888-888888888888";
const IDEMPOTENCY_KEY = "99999999-9999-4999-8999-999999999999";

function buildOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    locationId: LOCATION_ID,
    orderGroupId: null,
    rescheduledFromOrderId: null,
    rescheduledFrom: null,
    rescheduledTo: null,
    routeStop: null,
    deliveryDate: new Date(Date.UTC(2026, 7, 25)),
    status: OrderStatus.PENDING,
    createdById: USER_ID,
    createdAt: new Date("2026-08-21T15:00:00.000Z"),
    location: {
      phone: "987654321",
      customer: { id: CUSTOMER_ID, name: "Bodega Santa Rosa" },
    },
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
      findFirst: jest.fn<() => Promise<unknown>>(),
      findUnique: jest.fn<() => Promise<unknown>>(),
      count: jest.fn<() => Promise<unknown>>(),
      updateMany: jest.fn<() => Promise<unknown>>(),
    },
    orderGroup: {
      create: jest.fn<() => Promise<unknown>>(),
      findUnique: jest.fn<() => Promise<unknown>>(),
      findUniqueOrThrow: jest.fn<() => Promise<unknown>>(),
    },
    customer: { findUnique: jest.fn<() => Promise<unknown>>() },
    customerLocation: {
      findFirst: jest.fn<() => Promise<unknown>>(),
      findMany: jest.fn<() => Promise<unknown>>(),
    },
    product: { findMany: jest.fn<() => Promise<unknown>>() },
    $transaction: jest.fn<(arg: unknown) => Promise<unknown>>(),
  };
}

/** Every "create" test needs the customer to have a primary location. */
function primaryLocation(overrides: Record<string, unknown> = {}) {
  return { id: LOCATION_ID, ...overrides };
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
      prisma.customerLocation.findFirst.mockResolvedValue(primaryLocation());
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
      expect(createArgs.data.locationId).toBe(LOCATION_ID);
      expect(result.status).toBe(OrderStatus.PENDING);
      expect(result.deliveryDate).toBe("2026-08-25");
      expect(result.items).toHaveLength(1);
    });

    it("refuses when the customer has no primary location", async () => {
      prisma.customer.findUnique.mockResolvedValue(activeCustomer());
      prisma.customerLocation.findFirst.mockResolvedValue(null);

      await expect(
        service.create(
          { customerId: CUSTOMER_ID, deliveryDate: "2026-08-25", items: validItems() },
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it("persists unitPrice as an exact Decimal and returns it as a 2-decimal string", async () => {
      prisma.customer.findUnique.mockResolvedValue(activeCustomer());
      prisma.customerLocation.findFirst.mockResolvedValue(primaryLocation());
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
      prisma.customerLocation.findFirst.mockResolvedValue(primaryLocation());
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
      prisma.customerLocation.findFirst.mockResolvedValue(primaryLocation());
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
      prisma.customerLocation.findFirst.mockResolvedValue(primaryLocation());
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
      prisma.customerLocation.findFirst.mockResolvedValue(primaryLocation());
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

    it("totals quantity × unitPrice across several items", async () => {
      prisma.customer.findUnique.mockResolvedValue(activeCustomer());
      prisma.customerLocation.findFirst.mockResolvedValue(primaryLocation());
      prisma.product.findMany.mockResolvedValue([activeProduct()]);
      prisma.order.create.mockResolvedValue(
        buildOrder({
          items: [
            {
              id: "item-1",
              productId: PRODUCT_ID,
              product: { id: PRODUCT_ID, name: "Recarga 20L" },
              quantity: 3,
              unitPrice: new Prisma.Decimal("12.50"),
            },
            {
              id: "item-2",
              productId: OTHER_PRODUCT_ID,
              product: { id: OTHER_PRODUCT_ID, name: "Bidón 20L" },
              quantity: 2,
              unitPrice: new Prisma.Decimal("30.00"),
            },
          ],
        }),
      );

      const result = await service.create(
        { customerId: CUSTOMER_ID, deliveryDate: "2026-08-25", items: validItems() },
        USER_ID,
      );

      // 3 * 12.50 + 2 * 30.00 = 97.50
      expect(result.total).toBe("97.50");
    });

    it("totals prices that would betray a float sum, as an exact string", async () => {
      prisma.customer.findUnique.mockResolvedValue(activeCustomer());
      prisma.customerLocation.findFirst.mockResolvedValue(primaryLocation());
      prisma.product.findMany.mockResolvedValue([activeProduct()]);
      prisma.order.create.mockResolvedValue(
        buildOrder({
          items: [
            {
              id: "item-1",
              productId: PRODUCT_ID,
              product: { id: PRODUCT_ID, name: "Recarga 20L" },
              quantity: 3,
              unitPrice: new Prisma.Decimal("0.10"),
            },
            {
              id: "item-2",
              productId: OTHER_PRODUCT_ID,
              product: { id: OTHER_PRODUCT_ID, name: "Bidón 20L" },
              quantity: 1,
              unitPrice: new Prisma.Decimal("0.20"),
            },
          ],
        }),
      );

      const result = await service.create(
        { customerId: CUSTOMER_ID, deliveryDate: "2026-08-25", items: validItems() },
        USER_ID,
      );

      // 0.10 * 3 + 0.20 * 1 = 0.5000000000000001 in binary floating point.
      expect(result.total).toBe("0.50");
    });
  });

  describe("createBatch", () => {
    const batchDto = () => ({
      customerId: CUSTOMER_ID,
      deliveryDate: "2026-10-15",
      idempotencyKey: IDEMPOTENCY_KEY,
      locations: [
        { locationId: LOCATION_ID, items: validItems() },
        {
          locationId: OTHER_LOCATION_ID,
          items: [{ productId: OTHER_PRODUCT_ID, quantity: 1, unitPrice: "35.00" }],
        },
        { locationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", items: [] },
      ],
    });

    it("creates one group and one order per non-empty location in the same transaction", async () => {
      prisma.orderGroup.findUnique.mockResolvedValue(null);
      prisma.customer.findUnique.mockResolvedValue(activeCustomer());
      prisma.customerLocation.findMany.mockResolvedValue([
        { id: LOCATION_ID, name: "Principal", customerId: CUSTOMER_ID, active: true },
        { id: OTHER_LOCATION_ID, name: "Norte", customerId: CUSTOMER_ID, active: true },
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          name: "Sur",
          customerId: CUSTOMER_ID,
          active: true,
        },
      ]);
      prisma.product.findMany.mockResolvedValue([
        activeProduct(),
        activeProduct({ id: OTHER_PRODUCT_ID, name: "Bidón nuevo" }),
      ]);
      prisma.orderGroup.create.mockResolvedValue({ id: ORDER_GROUP_ID });
      prisma.order.create
        .mockResolvedValueOnce(buildOrder({ orderGroupId: ORDER_GROUP_ID }))
        .mockResolvedValueOnce(
          buildOrder({
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            locationId: OTHER_LOCATION_ID,
            orderGroupId: ORDER_GROUP_ID,
          }),
        );

      const result = await service.createBatch(batchDto(), USER_ID);

      expect(result).toHaveLength(2);
      expect(prisma.orderGroup.create).toHaveBeenCalledWith({
        data: {
          customerId: CUSTOMER_ID,
          createdById: USER_ID,
          idempotencyKey: IDEMPOTENCY_KEY,
        },
      });
      expect(prisma.order.create).toHaveBeenCalledTimes(2);
    });

    it("replays the existing orders when the same idempotency key carries the same request", async () => {
      prisma.orderGroup.findUnique.mockResolvedValue({
        id: ORDER_GROUP_ID,
        customerId: CUSTOMER_ID,
        createdById: USER_ID,
        createdAt: new Date(),
        idempotencyKey: IDEMPOTENCY_KEY,
        orders: [
          buildOrder({
            orderGroupId: ORDER_GROUP_ID,
            deliveryDate: new Date(Date.UTC(2026, 9, 15)),
          }),
          buildOrder({
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            locationId: OTHER_LOCATION_ID,
            orderGroupId: ORDER_GROUP_ID,
            deliveryDate: new Date(Date.UTC(2026, 9, 15)),
            items: [
              {
                id: "item-2",
                productId: OTHER_PRODUCT_ID,
                product: { id: OTHER_PRODUCT_ID, name: "Bidón nuevo" },
                quantity: 1,
                unitPrice: new Prisma.Decimal("35.00"),
              },
            ],
          }),
        ],
      });

      const result = await service.createBatch(batchDto(), USER_ID);

      expect(result.map((order) => order.locationId)).toEqual([LOCATION_ID, OTHER_LOCATION_ID]);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("rejects reusing an idempotency key for a different submission", async () => {
      prisma.orderGroup.findUnique.mockResolvedValue({
        id: ORDER_GROUP_ID,
        customerId: CUSTOMER_ID,
        createdById: USER_ID,
        createdAt: new Date(),
        idempotencyKey: IDEMPOTENCY_KEY,
        orders: [buildOrder({ orderGroupId: ORDER_GROUP_ID })],
      });

      await expect(service.createBatch(batchDto(), USER_ID)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
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
        where: { status: OrderStatus.PENDING, location: { customerId: CUSTOMER_ID } },
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

    // Lo que el selector de paradas de una ruta necesita: `addStop` con
    // origin=ORDER rechaza con 400 un pedido que no esté PENDING o que ya
    // tenga parada, así que ofrecer otra cosa sería construir un error.
    it("hasRouteStop=false brings only orders with no stop assigned", async () => {
      prisma.order.count.mockResolvedValue(0);
      prisma.order.findMany.mockResolvedValue([]);

      await service.findAll({
        page: DEFAULT_PAGE,
        limit: DEFAULT_LIMIT,
        status: OrderStatus.PENDING,
        hasRouteStop: false,
      });

      expect(prisma.order.count).toHaveBeenCalledWith({
        where: { status: OrderStatus.PENDING, routeStop: { is: null } },
      });
    });

    it("hasRouteStop=true brings only orders already on a route", async () => {
      prisma.order.count.mockResolvedValue(0);
      prisma.order.findMany.mockResolvedValue([]);

      await service.findAll({
        page: DEFAULT_PAGE,
        limit: DEFAULT_LIMIT,
        hasRouteStop: true,
      });

      expect(prisma.order.count).toHaveBeenCalledWith({
        where: { routeStop: { isNot: null } },
      });
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
      prisma.order.findFirst.mockResolvedValue(buildOrder());

      const result = await service.findOne(ORDER_ID);

      expect(result.id).toBe(ORDER_ID);
      expect(result.customer.name).toBe("Bodega Santa Rosa");
      expect(result.items[0]?.product.name).toBe("Recarga 20L");
    });

    it("returns sibling orders when the order belongs to an order group", async () => {
      prisma.order.findFirst.mockResolvedValue(buildOrder({ orderGroupId: ORDER_GROUP_ID }));
      prisma.order.findMany.mockResolvedValue([
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          locationId: OTHER_LOCATION_ID,
          location: { name: "Sucursal Sur" },
        },
      ]);

      const result = await service.findOne(ORDER_ID);

      expect(prisma.order.findMany).toHaveBeenCalledWith({
        where: {
          orderGroupId: ORDER_GROUP_ID,
          id: { not: ORDER_ID },
        },
        select: {
          id: true,
          locationId: true,
          location: { select: { name: true } },
        },
        orderBy: { createdAt: "asc" },
      });
      expect(result.siblingOrders).toEqual([
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          locationId: OTHER_LOCATION_ID,
          locationName: "Sucursal Sur",
        },
      ]);
    });

    it("throws NotFoundException for an unknown id", async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      await expect(service.findOne(ORDER_ID)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("cancel", () => {
    it("cancels a PENDING order, guarding the status inside the WHERE clause", async () => {
      prisma.order.updateMany.mockResolvedValue({ count: 1 });
      prisma.order.findFirst.mockResolvedValue(buildOrder({ status: OrderStatus.CANCELLED }));

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
      // El estado va traducido, no como nombre de enum: este mensaje llega tal
      // cual a la pantalla de pedidos.
      await expect(service.cancel(ORDER_ID)).rejects.toThrow(
        "Solo se puede cancelar un pedido pendiente; este está en ruta",
      );
    });

    it("throws NotFoundException when the order does not exist at all", async () => {
      prisma.order.updateMany.mockResolvedValue({ count: 0 });
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(service.cancel(ORDER_ID)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("reschedule", () => {
    it("copies items and exact unit prices to a new PENDING order, defaulting to next day", async () => {
      const originalFailed = buildOrder({
        status: OrderStatus.FAILED,
        deliveryDate: new Date(Date.UTC(2026, 7, 25)),
        rescheduledTo: null,
      });
      const newOrderId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
      const createdRescheduled = buildOrder({
        id: newOrderId,
        status: OrderStatus.PENDING,
        deliveryDate: new Date(Date.UTC(2026, 7, 26)),
        rescheduledFromOrderId: ORDER_ID,
      });

      const txMock = {
        order: {
          findUnique: jest.fn<() => Promise<unknown>>().mockResolvedValue(originalFailed),
          create: jest.fn<() => Promise<unknown>>().mockResolvedValue(createdRescheduled),
        },
      };
      prisma.$transaction.mockImplementation(async (cb: unknown) => {
        return (cb as (tx: typeof txMock) => Promise<unknown>)(txMock);
      });

      const result = await service.reschedule(ORDER_ID, {}, USER_ID);

      expect(txMock.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            locationId: LOCATION_ID,
            deliveryDate: new Date(Date.UTC(2026, 7, 26)),
            status: OrderStatus.PENDING,
            rescheduledFromOrderId: ORDER_ID,
            createdById: USER_ID,
            items: {
              create: [
                {
                  productId: PRODUCT_ID,
                  quantity: 3,
                  unitPrice: new Prisma.Decimal("12.5"),
                },
              ],
            },
          }),
        }),
      );
      expect(result.id).toBe(newOrderId);
      expect(result.deliveryDate).toBe("2026-08-26");
      expect(result.status).toBe(OrderStatus.PENDING);
    });

    it("accepts an explicit deliveryDate for the rescheduled order", async () => {
      const originalFailed = buildOrder({
        status: OrderStatus.FAILED,
        deliveryDate: new Date(Date.UTC(2026, 7, 25)),
        rescheduledTo: null,
      });
      const createdRescheduled = buildOrder({
        status: OrderStatus.PENDING,
        deliveryDate: new Date(Date.UTC(2026, 7, 28)),
        rescheduledFromOrderId: ORDER_ID,
      });

      const txMock = {
        order: {
          findUnique: jest.fn<() => Promise<unknown>>().mockResolvedValue(originalFailed),
          create: jest.fn<() => Promise<unknown>>().mockResolvedValue(createdRescheduled),
        },
      };
      prisma.$transaction.mockImplementation(async (cb: unknown) => {
        return (cb as (tx: typeof txMock) => Promise<unknown>)(txMock);
      });

      const result = await service.reschedule(ORDER_ID, { deliveryDate: "2026-08-28" }, USER_ID);

      expect(txMock.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            deliveryDate: new Date(Date.UTC(2026, 7, 28)),
          }),
        }),
      );
      expect(result.deliveryDate).toBe("2026-08-28");
    });

    it("rejects rescheduling an order that is not FAILED", async () => {
      const order = buildOrder({ status: OrderStatus.PENDING });
      const txMock = {
        order: {
          findUnique: jest.fn<() => Promise<unknown>>().mockResolvedValue(order),
        },
      };
      prisma.$transaction.mockImplementation(async (cb: unknown) => {
        return (cb as (tx: typeof txMock) => Promise<unknown>)(txMock);
      });

      await expect(service.reschedule(ORDER_ID, {}, USER_ID)).rejects.toBeInstanceOf(
        ConflictException,
      );
      await expect(service.reschedule(ORDER_ID, {}, USER_ID)).rejects.toThrow(
        "Solo se puede reprogramar un pedido no entregado; este está pendiente",
      );
    });

    it("rejects rescheduling an order that was already rescheduled", async () => {
      const order = buildOrder({
        status: OrderStatus.FAILED,
        rescheduledTo: { id: "rescheduled-id", deliveryDate: new Date(Date.UTC(2026, 7, 26)) },
      });
      const txMock = {
        order: {
          findUnique: jest.fn<() => Promise<unknown>>().mockResolvedValue(order),
        },
      };
      prisma.$transaction.mockImplementation(async (cb: unknown) => {
        return (cb as (tx: typeof txMock) => Promise<unknown>)(txMock);
      });

      await expect(service.reschedule(ORDER_ID, {}, USER_ID)).rejects.toBeInstanceOf(
        ConflictException,
      );
      await expect(service.reschedule(ORDER_ID, {}, USER_ID)).rejects.toThrow(
        "El pedido ya fue reprogramado para el 26/08/2026",
      );
    });

    it("throws NotFoundException if the order does not exist", async () => {
      const txMock = {
        order: {
          findUnique: jest.fn<() => Promise<unknown>>().mockResolvedValue(null),
        },
      };
      prisma.$transaction.mockImplementation(async (cb: unknown) => {
        return (cb as (tx: typeof txMock) => Promise<unknown>)(txMock);
      });

      await expect(service.reschedule(ORDER_ID, {}, USER_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("rescheduleByDate", () => {
    it("reschedules all FAILED orders for a date in one transaction", async () => {
      const order1 = buildOrder({
        id: "order-1",
        status: OrderStatus.FAILED,
        deliveryDate: new Date(Date.UTC(2026, 7, 25)),
        rescheduledTo: null,
      });
      const order2 = buildOrder({
        id: "order-2",
        status: OrderStatus.FAILED,
        deliveryDate: new Date(Date.UTC(2026, 7, 25)),
        rescheduledTo: null,
      });
      const resched1 = buildOrder({
        id: "resched-1",
        deliveryDate: new Date(Date.UTC(2026, 7, 26)),
      });
      const resched2 = buildOrder({
        id: "resched-2",
        deliveryDate: new Date(Date.UTC(2026, 7, 26)),
      });

      const txMock = {
        order: {
          findMany: jest.fn<() => Promise<unknown>>().mockResolvedValue([order1, order2]),
          create: jest
            .fn<() => Promise<unknown>>()
            .mockResolvedValueOnce(resched1)
            .mockResolvedValueOnce(resched2),
        },
      };
      prisma.$transaction.mockImplementation(async (cb: unknown) => {
        return (cb as (tx: typeof txMock) => Promise<unknown>)(txMock);
      });

      const result = await service.rescheduleByDate({ deliveryDate: "2026-08-25" }, USER_ID);

      expect(txMock.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            deliveryDate: new Date(Date.UTC(2026, 7, 25)),
            status: OrderStatus.FAILED,
          },
        }),
      );
      expect(txMock.order.create).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(2);
    });

    it("rejects if one order of the date was already rescheduled", async () => {
      const order1 = buildOrder({
        id: "order-1",
        status: OrderStatus.FAILED,
        deliveryDate: new Date(Date.UTC(2026, 7, 25)),
        rescheduledTo: { id: "resched-1", deliveryDate: new Date(Date.UTC(2026, 7, 26)) },
      });
      const order2 = buildOrder({
        id: "order-2",
        status: OrderStatus.FAILED,
        deliveryDate: new Date(Date.UTC(2026, 7, 25)),
        rescheduledTo: null,
      });

      const txMock = {
        order: {
          findMany: jest.fn<() => Promise<unknown>>().mockResolvedValue([order1, order2]),
          create: jest.fn<() => Promise<unknown>>(),
        },
      };
      prisma.$transaction.mockImplementation(async (cb: unknown) => {
        return (cb as (tx: typeof txMock) => Promise<unknown>)(txMock);
      });

      await expect(
        service.rescheduleByDate({ deliveryDate: "2026-08-25" }, USER_ID),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(txMock.order.create).not.toHaveBeenCalled();
    });

    it("rejects with BadRequestException if there are no FAILED orders on that date", async () => {
      const txMock = {
        order: {
          findMany: jest.fn<() => Promise<unknown>>().mockResolvedValue([]),
        },
      };
      prisma.$transaction.mockImplementation(async (cb: unknown) => {
        return (cb as (tx: typeof txMock) => Promise<unknown>)(txMock);
      });

      await expect(
        service.rescheduleByDate({ deliveryDate: "2026-08-25" }, USER_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
