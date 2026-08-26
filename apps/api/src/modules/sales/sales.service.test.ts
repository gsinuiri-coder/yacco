import { BadRequestException } from "@nestjs/common";
import {
  ContainerMovementType,
  ContainerState,
  PaymentStatus,
  Prisma,
  ProductType,
} from "@prisma/client";
import { jest } from "@jest/globals";
import { ContainerMovementsService } from "../container-movements/container-movements.service.js";
import { SalesService } from "./sales.service.js";
import type { RegisterStopDeliveryParams } from "./sales.service.js";

const LOCATION_ID = "11111111-1111-4111-8111-111111111111";
const CUSTOMER_ID = "22222222-2222-4222-8222-222222222222";
const ROUTE_ID = "33333333-3333-4333-8333-333333333333";
const STOP_ID = "44444444-4444-4444-8444-444444444444";
const RECORDED_BY_ID = "55555555-5555-4555-8555-555555555555";
const REFILL_PRODUCT_ID = "66666666-6666-4666-8666-666666666666";
const CONTAINER_SALE_PRODUCT_ID = "77777777-7777-4777-8777-777777777777";
const CONTAINER_TYPE_ID = "88888888-8888-4888-8888-888888888888";
const PAYMENT_METHOD_ID = "99999999-9999-4999-8999-999999999999";
const AUTHORIZER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

// HU-12 §2.4 E1: "Dado una parada con 3 llenos a entregar, cuando registro 3
// entregados y 3 vacíos recogidos, entonces el saldo del cliente no varía."
// HU-13 §2.4 E1: "Dado un total de S/ 40, cuando registro un pago de S/ 25,
// entonces se registra el abono y la deuda del cliente aumenta en S/ 15."
// HU-09 §2.4 E1 informs creditLimitExceeded below: it is a sale "al fiado"
// — computed net of any same-visit CONFIRMED payment, never off the gross
// total.

function decimal(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function buildRefillProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: REFILL_PRODUCT_ID,
    name: "Recarga 20L",
    active: true,
    type: ProductType.REFILL,
    containerTypeId: CONTAINER_TYPE_ID,
    listPrice: decimal("12.50"),
    ...overrides,
  };
}

function buildContainerSaleProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: CONTAINER_SALE_PRODUCT_ID,
    name: "Envase 20L",
    active: true,
    type: ProductType.CONTAINER_SALE,
    containerTypeId: CONTAINER_TYPE_ID,
    listPrice: decimal("50.00"),
    ...overrides,
  };
}

function buildTxMock() {
  return {
    customerLocation: { findUnique: jest.fn<() => Promise<unknown>>() },
    product: { findMany: jest.fn<() => Promise<unknown>>() },
    customerPrice: { findMany: jest.fn<() => Promise<unknown>>() },
    user: { findUnique: jest.fn<() => Promise<unknown>>() },
    containerType: { findUnique: jest.fn<() => Promise<unknown>>() },
    paymentMethod: { findUnique: jest.fn<() => Promise<unknown>>() },
    customer: { update: jest.fn<() => Promise<unknown>>() },
    sale: { create: jest.fn<() => Promise<unknown>>() },
    payment: { create: jest.fn<() => Promise<unknown>>() },
    customerContainerBalance: { findMany: jest.fn<() => Promise<unknown>>() },
  };
}

function buildContainerMovementsMock() {
  return {
    getRouteFullStock: jest.fn<() => Promise<number>>(),
    createWithinTransaction: jest.fn<() => Promise<unknown>>(),
  };
}

describe("SalesService.registerStopDeliveryWithinTransaction", () => {
  let service: SalesService;
  let tx: ReturnType<typeof buildTxMock>;
  let containerMovements: ReturnType<typeof buildContainerMovementsMock>;

  function baseParams(
    overrides: Partial<RegisterStopDeliveryParams> = {},
  ): RegisterStopDeliveryParams {
    return {
      routeId: ROUTE_ID,
      stopId: STOP_ID,
      locationId: LOCATION_ID,
      items: [{ productId: REFILL_PRODUCT_ID, quantity: 2 }],
      containersReturned: [],
      recordedById: RECORDED_BY_ID,
      ...overrides,
    };
  }

  beforeEach(() => {
    tx = buildTxMock();
    containerMovements = buildContainerMovementsMock();
    service = new SalesService(
      // PrismaService is never used by this method (it always takes an
      // explicit tx), so a stub is enough here.
      undefined as never,
      containerMovements as unknown as ContainerMovementsService,
    );

    tx.customerLocation.findUnique.mockResolvedValue({
      id: LOCATION_ID,
      customerId: CUSTOMER_ID,
      customer: { id: CUSTOMER_ID, creditLimit: null, debtBalance: decimal("0.00") },
    });
    tx.product.findMany.mockResolvedValue([buildRefillProduct()]);
    tx.customerPrice.findMany.mockResolvedValue([]);
    containerMovements.getRouteFullStock.mockResolvedValue(100);
    tx.sale.create.mockResolvedValue({ id: "sale-1", total: decimal("25.00") });
    tx.customerContainerBalance.findMany.mockResolvedValue([
      {
        containerTypeId: CONTAINER_TYPE_ID,
        quantity: 2,
        containerType: { id: CONTAINER_TYPE_ID, name: "Bidón 20L" },
      },
    ]);
  });

  it("registers a REFILL delivery: LOAN_DELIVERY movement, listPrice total, cash payment CONFIRMED and subtracted from debt", async () => {
    tx.paymentMethod.findUnique.mockResolvedValue({
      id: PAYMENT_METHOD_ID,
      active: true,
      requiresConfirmation: false,
    });
    tx.payment.create.mockResolvedValue({
      id: "payment-1",
      status: PaymentStatus.CONFIRMED,
      amount: decimal("25.00"),
    });

    const result = await service.registerStopDeliveryWithinTransaction(
      tx as never,
      baseParams({ payment: { paymentMethodId: PAYMENT_METHOD_ID, amount: "25.00" } }),
    );

    expect(tx.sale.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          locationId: LOCATION_ID,
          stopId: STOP_ID,
          total: decimal("25.00"),
          creditLimitExceeded: false,
          items: {
            create: [{ productId: REFILL_PRODUCT_ID, quantity: 2, unitPrice: decimal("12.50") }],
          },
        }) as unknown,
      }),
    );
    // total = 12.50 * 2 = 25.00, fully covered by the CONFIRMED cash payment.
    expect(tx.customer.update).toHaveBeenCalledWith({
      where: { id: CUSTOMER_ID },
      data: { debtBalance: { increment: decimal("0.00") } },
    });
    expect(containerMovements.createWithinTransaction).toHaveBeenCalledWith(
      tx,
      {
        type: ContainerMovementType.LOAN_DELIVERY,
        containerTypeId: CONTAINER_TYPE_ID,
        quantity: 2,
        fromState: ContainerState.FULL_ON_ROUTE,
        locationId: LOCATION_ID,
        toState: ContainerState.WITH_CUSTOMER,
      },
      RECORDED_BY_ID,
      { routeId: ROUTE_ID, stopId: STOP_ID },
    );
    expect(result.payment).toEqual({
      id: "payment-1",
      status: PaymentStatus.CONFIRMED,
      amount: "25.00",
    });
    expect(result.containerBalances).toEqual([
      {
        containerTypeId: CONTAINER_TYPE_ID,
        containerType: { id: CONTAINER_TYPE_ID, name: "Bidón 20L" },
        quantity: 2,
      },
    ]);
  });

  it("a Yape payment is born PENDING and does not reduce debtBalance", async () => {
    tx.paymentMethod.findUnique.mockResolvedValue({
      id: PAYMENT_METHOD_ID,
      active: true,
      requiresConfirmation: true,
    });
    tx.payment.create.mockResolvedValue({
      id: "payment-1",
      status: PaymentStatus.PENDING,
      amount: decimal("25.00"),
    });

    const result = await service.registerStopDeliveryWithinTransaction(
      tx as never,
      baseParams({ payment: { paymentMethodId: PAYMENT_METHOD_ID, amount: "25.00" } }),
    );

    // Debt increases by the FULL sale total; the pending payment does not offset it.
    expect(tx.customer.update).toHaveBeenCalledWith({
      where: { id: CUSTOMER_ID },
      data: { debtBalance: { increment: decimal("25.00") } },
    });
    expect(tx.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: PaymentStatus.PENDING,
          confirmedAt: null,
          confirmedById: null,
        }) as unknown,
      }),
    );
    expect(result.payment?.status).toBe(PaymentStatus.PENDING);
  });

  it("no payment: debt increases by the full total, and no Payment row is created", async () => {
    const result = await service.registerStopDeliveryWithinTransaction(tx as never, baseParams());

    expect(tx.payment.create).not.toHaveBeenCalled();
    expect(tx.customer.update).toHaveBeenCalledWith({
      where: { id: CUSTOMER_ID },
      data: { debtBalance: { increment: decimal("25.00") } },
    });
    expect(result.payment).toBeNull();
  });

  it("rejects a price override with no priceOverrideAuthorizedById", async () => {
    await expect(
      service.registerStopDeliveryWithinTransaction(
        tx as never,
        baseParams({ items: [{ productId: REFILL_PRODUCT_ID, quantity: 2, unitPrice: "15.00" }] }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.sale.create).not.toHaveBeenCalled();
  });

  it("accepts a price override when priceOverrideAuthorizedById is given, charging the overridden price", async () => {
    tx.user.findUnique.mockResolvedValue({ id: AUTHORIZER_ID });

    await service.registerStopDeliveryWithinTransaction(
      tx as never,
      baseParams({
        items: [{ productId: REFILL_PRODUCT_ID, quantity: 2, unitPrice: "15.00" }],
        priceOverrideAuthorizedById: AUTHORIZER_ID,
      }),
    );

    expect(tx.sale.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          priceOverrideAuthorizedById: AUTHORIZER_ID,
          items: {
            create: [{ productId: REFILL_PRODUCT_ID, quantity: 2, unitPrice: decimal("15.00") }],
          },
        }) as unknown,
      }),
    );
  });

  it("rejects an unknown priceOverrideAuthorizedById", async () => {
    tx.user.findUnique.mockResolvedValue(null);

    await expect(
      service.registerStopDeliveryWithinTransaction(
        tx as never,
        baseParams({
          items: [{ productId: REFILL_PRODUCT_ID, quantity: 2, unitPrice: "15.00" }],
          priceOverrideAuthorizedById: AUTHORIZER_ID,
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.sale.create).not.toHaveBeenCalled();
  });

  it("resolves the price from a customer-wide CustomerPrice ahead of the product's listPrice", async () => {
    tx.customerPrice.findMany.mockResolvedValue([
      { productId: REFILL_PRODUCT_ID, locationId: null, price: decimal("10.00") },
    ]);

    await service.registerStopDeliveryWithinTransaction(tx as never, baseParams());

    expect(tx.sale.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          total: decimal("20.00"),
          items: {
            create: [{ productId: REFILL_PRODUCT_ID, quantity: 2, unitPrice: decimal("10.00") }],
          },
        }) as unknown,
      }),
    );
  });

  it("resolves the price from a location-specific CustomerPrice ahead of a customer-wide one", async () => {
    tx.customerPrice.findMany.mockResolvedValue([
      { productId: REFILL_PRODUCT_ID, locationId: null, price: decimal("10.00") },
      { productId: REFILL_PRODUCT_ID, locationId: LOCATION_ID, price: decimal("9.00") },
    ]);

    await service.registerStopDeliveryWithinTransaction(tx as never, baseParams());

    expect(tx.sale.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ total: decimal("18.00") }) as unknown,
      }),
    );
  });

  it("rejects an unknown location", async () => {
    tx.customerLocation.findUnique.mockResolvedValue(null);

    await expect(
      service.registerStopDeliveryWithinTransaction(tx as never, baseParams()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects a payment method that is no longer active", async () => {
    tx.paymentMethod.findUnique.mockResolvedValue({
      id: PAYMENT_METHOD_ID,
      active: false,
      requiresConfirmation: false,
    });

    await expect(
      service.registerStopDeliveryWithinTransaction(
        tx as never,
        baseParams({ payment: { paymentMethodId: PAYMENT_METHOD_ID, amount: "25.00" } }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("an unitPrice equal to the resolved price is not an override, even with no authorizer", async () => {
    await expect(
      service.registerStopDeliveryWithinTransaction(
        tx as never,
        baseParams({ items: [{ productId: REFILL_PRODUCT_ID, quantity: 2, unitPrice: "12.50" }] }),
      ),
    ).resolves.toBeDefined();
  });

  it("blocks when the truck doesn't have enough fulls, naming how many there are and how many were requested", async () => {
    containerMovements.getRouteFullStock.mockResolvedValue(1);

    await expect(
      service.registerStopDeliveryWithinTransaction(tx as never, baseParams()),
    ).rejects.toThrow(/hay 1, se pidió 2/);
    expect(tx.sale.create).not.toHaveBeenCalled();
    expect(containerMovements.createWithinTransaction).not.toHaveBeenCalled();
  });

  it("flags creditLimitExceeded without blocking the sale", async () => {
    tx.customerLocation.findUnique.mockResolvedValue({
      id: LOCATION_ID,
      customerId: CUSTOMER_ID,
      customer: { id: CUSTOMER_ID, creditLimit: decimal("20.00"), debtBalance: decimal("0.00") },
    });

    const result = await service.registerStopDeliveryWithinTransaction(tx as never, baseParams());

    expect(result.sale.creditLimitExceeded).toBe(true);
    expect(tx.sale.create).toHaveBeenCalled();
  });

  it("regression: a sale fully covered by a same-visit CONFIRMED payment is NOT flagged as exceeding the credit limit, however large the total (HU-09 is about credit, not gross total)", async () => {
    tx.customerLocation.findUnique.mockResolvedValue({
      id: LOCATION_ID,
      customerId: CUSTOMER_ID,
      customer: { id: CUSTOMER_ID, creditLimit: decimal("10.00"), debtBalance: decimal("0.00") },
    });
    tx.paymentMethod.findUnique.mockResolvedValue({
      id: PAYMENT_METHOD_ID,
      active: true,
      requiresConfirmation: false,
    });
    tx.payment.create.mockResolvedValue({
      id: "payment-1",
      status: PaymentStatus.CONFIRMED,
      amount: decimal("25.00"),
    });

    // Sale total (25.00) alone exceeds the 10.00 limit, but a CONFIRMED
    // payment covers it in full: net debt increase is 0, so no credit was
    // ever extended, and the flag must stay false.
    const result = await service.registerStopDeliveryWithinTransaction(
      tx as never,
      baseParams({ payment: { paymentMethodId: PAYMENT_METHOD_ID, amount: "25.00" } }),
    );

    expect(result.sale.creditLimitExceeded).toBe(false);
  });

  it("HU-13 E1: a partial CONFIRMED payment (25 of 40) leaves exactly the residual (15) as debt", async () => {
    tx.user.findUnique.mockResolvedValue({ id: AUTHORIZER_ID });
    tx.paymentMethod.findUnique.mockResolvedValue({
      id: PAYMENT_METHOD_ID,
      active: true,
      requiresConfirmation: false,
    });
    tx.payment.create.mockResolvedValue({
      id: "payment-1",
      status: PaymentStatus.CONFIRMED,
      amount: decimal("25.00"),
    });

    await service.registerStopDeliveryWithinTransaction(
      tx as never,
      baseParams({
        items: [{ productId: REFILL_PRODUCT_ID, quantity: 1, unitPrice: "40.00" }],
        priceOverrideAuthorizedById: AUTHORIZER_ID,
        payment: { paymentMethodId: PAYMENT_METHOD_ID, amount: "25.00" },
      }),
    );

    expect(tx.customer.update).toHaveBeenCalledWith({
      where: { id: CUSTOMER_ID },
      data: { debtBalance: { increment: decimal("15.00") } },
    });
  });

  it("a CONTAINER_SALE product records FULL_SALE, leaving the customer's container balance untouched", async () => {
    tx.product.findMany.mockResolvedValue([buildContainerSaleProduct()]);
    tx.customerContainerBalance.findMany.mockResolvedValue([]);

    const result = await service.registerStopDeliveryWithinTransaction(
      tx as never,
      baseParams({ items: [{ productId: CONTAINER_SALE_PRODUCT_ID, quantity: 1 }] }),
    );

    expect(containerMovements.createWithinTransaction).toHaveBeenCalledWith(
      tx,
      {
        type: ContainerMovementType.FULL_SALE,
        containerTypeId: CONTAINER_TYPE_ID,
        quantity: 1,
        fromState: ContainerState.FULL_ON_ROUTE,
        locationId: LOCATION_ID,
      },
      RECORDED_BY_ID,
      { routeId: ROUTE_ID, stopId: STOP_ID },
    );
    expect(tx.customerContainerBalance.findMany).not.toHaveBeenCalled();
    expect(result.containerBalances).toEqual([]);
  });

  it("registers a partial container return as an EMPTY_PICKUP movement and reports the resulting balance", async () => {
    await service.registerStopDeliveryWithinTransaction(
      tx as never,
      baseParams({ containersReturned: [{ containerTypeId: CONTAINER_TYPE_ID, quantity: 1 }] }),
    );

    expect(containerMovements.createWithinTransaction).toHaveBeenCalledWith(
      tx,
      {
        type: ContainerMovementType.EMPTY_PICKUP,
        containerTypeId: CONTAINER_TYPE_ID,
        quantity: 1,
        fromState: ContainerState.WITH_CUSTOMER,
        toState: ContainerState.EMPTY_ON_ROUTE,
        locationId: LOCATION_ID,
      },
      RECORDED_BY_ID,
      { routeId: ROUTE_ID, stopId: STOP_ID },
    );
    expect(tx.customerContainerBalance.findMany).toHaveBeenCalled();
  });

  it("HU-12 E1: delivering 3 and getting 3 back (a 1:1 exchange) leaves the container balance unchanged", async () => {
    tx.customerContainerBalance.findMany.mockResolvedValue([
      {
        containerTypeId: CONTAINER_TYPE_ID,
        quantity: 0,
        containerType: { id: CONTAINER_TYPE_ID, name: "Bidón 20L" },
      },
    ]);

    const result = await service.registerStopDeliveryWithinTransaction(
      tx as never,
      baseParams({
        items: [{ productId: REFILL_PRODUCT_ID, quantity: 3 }],
        containersReturned: [{ containerTypeId: CONTAINER_TYPE_ID, quantity: 3 }],
      }),
    );

    expect(containerMovements.createWithinTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ type: ContainerMovementType.LOAN_DELIVERY, quantity: 3 }),
      RECORDED_BY_ID,
      { routeId: ROUTE_ID, stopId: STOP_ID },
    );
    expect(containerMovements.createWithinTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ type: ContainerMovementType.EMPTY_PICKUP, quantity: 3 }),
      RECORDED_BY_ID,
      { routeId: ROUTE_ID, stopId: STOP_ID },
    );
    expect(result.containerBalances).toEqual([
      {
        containerTypeId: CONTAINER_TYPE_ID,
        containerType: { id: CONTAINER_TYPE_ID, name: "Bidón 20L" },
        quantity: 0,
      },
    ]);
  });

  it("rejects an unknown product", async () => {
    tx.product.findMany.mockResolvedValue([]);

    await expect(
      service.registerStopDeliveryWithinTransaction(tx as never, baseParams()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects a product no longer active", async () => {
    tx.product.findMany.mockResolvedValue([buildRefillProduct({ active: false })]);

    await expect(
      service.registerStopDeliveryWithinTransaction(tx as never, baseParams()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects an unknown payment method", async () => {
    tx.paymentMethod.findUnique.mockResolvedValue(null);

    await expect(
      service.registerStopDeliveryWithinTransaction(
        tx as never,
        baseParams({ payment: { paymentMethodId: PAYMENT_METHOD_ID, amount: "25.00" } }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
