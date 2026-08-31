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

describe("SalesService.voidStopDeliveryWithinTransaction", () => {
  const SALE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const PAYMENT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const VOIDED_BY_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const OTHER_CONTAINER_TYPE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const VOID_REASON = "Se anotó la parada equivocada";
  /** La entrega original: de la semana pasada, bien lejos de "ahora". */
  const SOLD_AT = new Date("2026-08-24T15:00:00.000Z");

  function buildVoidTxMock() {
    return {
      sale: {
        findFirst: jest.fn<() => Promise<unknown>>(),
        updateMany: jest.fn<() => Promise<{ count: number }>>(),
      },
      payment: { updateMany: jest.fn<() => Promise<unknown>>() },
      customer: { update: jest.fn<() => Promise<unknown>>() },
      containerMovement: { findMany: jest.fn<() => Promise<unknown>>() },
    };
  }

  /** Una fila del ledger de la parada, tal como la lee el método. */
  function movement(
    type: ContainerMovementType,
    quantity: number,
    containerTypeId = CONTAINER_TYPE_ID,
  ) {
    return { type, containerTypeId, quantity, locationId: LOCATION_ID, routeId: ROUTE_ID };
  }

  function saleRow(overrides: Record<string, unknown> = {}) {
    return {
      id: SALE_ID,
      total: decimal("25.00"),
      soldAt: SOLD_AT,
      location: { customerId: CUSTOMER_ID },
      payments: [],
      ...overrides,
    };
  }

  function paymentRow(status: PaymentStatus, amount = "10.00") {
    return { id: PAYMENT_ID, amount: decimal(amount), status };
  }

  let service: SalesService;
  let tx: ReturnType<typeof buildVoidTxMock>;
  let containerMovements: ReturnType<typeof buildContainerMovementsMock>;

  function voidParams() {
    return { stopId: STOP_ID, voidedById: VOIDED_BY_ID, voidReason: VOID_REASON };
  }

  /**
   * Los argumentos de una llamada al mock, tipados por quien los lee. Los
   * mocks se declaran sin argumentos (`jest.fn<() => Promise<unknown>>()`) y
   * `noUncheckedIndexedAccess` agrega `| undefined` al indexar, así que el
   * salto por `unknown` es inevitable; concentrarlo acá evita repetirlo en
   * cada expect.
   */
  function firstCall<T>(calls: unknown[][]): T {
    return calls[0] as unknown as T;
  }

  beforeEach(() => {
    tx = buildVoidTxMock();
    containerMovements = buildContainerMovementsMock();
    service = new SalesService(
      undefined as never,
      containerMovements as unknown as ContainerMovementsService,
    );
    tx.sale.findFirst.mockResolvedValue(saleRow());
    tx.sale.updateMany.mockResolvedValue({ count: 1 });
    tx.containerMovement.findMany.mockResolvedValue([]);
  });

  it("sin venta vigente no escribe nada y no falla: la parada no tenía qué anular", async () => {
    tx.sale.findFirst.mockResolvedValue(null);

    const result = await service.voidStopDeliveryWithinTransaction(tx as never, voidParams());

    expect(result).toEqual({ sale: null, payments: [], debtDelta: "0.00", voidMovements: [] });
    expect(tx.sale.updateMany).not.toHaveBeenCalled();
    expect(tx.payment.updateMany).not.toHaveBeenCalled();
    expect(tx.customer.update).not.toHaveBeenCalled();
    expect(containerMovements.createWithinTransaction).not.toHaveBeenCalled();
    // Ni siquiera lee el ledger: sin venta no hay corrección que hacer.
    expect(tx.containerMovement.findMany).not.toHaveBeenCalled();
  });

  it("solo busca la venta VIGENTE de la parada, y de ella solo los cobros vigentes", async () => {
    await service.voidStopDeliveryWithinTransaction(tx as never, voidParams());

    const [args] = firstCall<[{ where: unknown; select: { payments: { where: unknown } } }]>(
      tx.sale.findFirst.mock.calls,
    );
    expect(args.where).toEqual({ stopId: STOP_ID, voidedAt: null });
    // El sub-filtro es la segunda línea de defensa contra devolver dos veces
    // el mismo cobro: sin él, un pago ya anulado volvería a sumar a la deuda.
    expect(args.select.payments.where).toEqual({ voidedAt: null });
  });

  it("la escritura repite la guarda: si otra transacción anuló primero, no escribe nada", async () => {
    // La ganadora de la carrera ya dejó la venta anulada, así que el UPDATE
    // guardado no toca ninguna fila.
    tx.sale.updateMany.mockResolvedValue({ count: 0 });

    const result = await service.voidStopDeliveryWithinTransaction(tx as never, voidParams());

    expect(result).toEqual({ sale: null, payments: [], debtDelta: "0.00", voidMovements: [] });
    // Y sobre todo: la deuda no se devuelve dos veces.
    expect(tx.customer.update).not.toHaveBeenCalled();
    expect(tx.payment.updateMany).not.toHaveBeenCalled();
    expect(containerMovements.createWithinTransaction).not.toHaveBeenCalled();
  });

  it("una venta sin cobros baja la deuda por su total entero", async () => {
    await service.voidStopDeliveryWithinTransaction(tx as never, voidParams());

    expect(tx.customer.update).toHaveBeenCalledWith({
      where: { id: CUSTOMER_ID },
      data: { debtBalance: { increment: decimal("-25.00") } },
    });
    expect(tx.payment.updateMany).not.toHaveBeenCalled();
  });

  it("marca la venta con las tres columnas de anulación, sin tocar su monto", async () => {
    const result = await service.voidStopDeliveryWithinTransaction(tx as never, voidParams());

    const [args] = firstCall<[{ where: unknown; data: Record<string, unknown> }]>(
      tx.sale.updateMany.mock.calls,
    );
    expect(args.where).toEqual({ id: SALE_ID, voidedAt: null });
    expect(args.data.voidedById).toBe(VOIDED_BY_ID);
    expect(args.data.voidReason).toBe(VOID_REASON);
    expect(args.data.voidedAt).toBeInstanceOf(Date);
    // El monto no está entre lo que se escribe: la fila del libro no se edita.
    expect(args.data).not.toHaveProperty("total");
    expect(result.sale).toEqual({ id: SALE_ID, total: "25.00" });
  });

  it("un cobro CONFIRMED devuelve su monto a la deuda, y se marca anulado sin cambiar de estado", async () => {
    tx.sale.findFirst.mockResolvedValue(
      saleRow({ payments: [paymentRow(PaymentStatus.CONFIRMED)] }),
    );

    const result = await service.voidStopDeliveryWithinTransaction(tx as never, voidParams());

    // -25.00 de la venta, +10.00 del cobro que sí había bajado la deuda.
    expect(tx.customer.update).toHaveBeenCalledWith({
      where: { id: CUSTOMER_ID },
      data: { debtBalance: { increment: decimal("-15.00") } },
    });
    const [args] = firstCall<[{ where: unknown; data: Record<string, unknown> }]>(
      tx.payment.updateMany.mock.calls,
    );
    expect(args.where).toEqual({ id: { in: [PAYMENT_ID] }, voidedAt: null });
    // Anular NO es rechazar: el estado se queda donde estaba.
    expect(args.data).not.toHaveProperty("status");
    expect(result.debtDelta).toBe("-15.00");
    expect(result.payments).toEqual([
      { id: PAYMENT_ID, amount: "10.00", status: PaymentStatus.CONFIRMED },
    ]);
  });

  it.each([PaymentStatus.PENDING, PaymentStatus.REJECTED])(
    "un cobro %s se marca anulado pero no devuelve deuda: nunca la había movido",
    async (status) => {
      tx.sale.findFirst.mockResolvedValue(saleRow({ payments: [paymentRow(status)] }));

      const result = await service.voidStopDeliveryWithinTransaction(tx as never, voidParams());

      expect(tx.customer.update).toHaveBeenCalledWith({
        where: { id: CUSTOMER_ID },
        data: { debtBalance: { increment: decimal("-25.00") } },
      });
      expect(result.debtDelta).toBe("-25.00");
      // Se marca igual: la fila estuvo mal anotada, aunque no moviera plata.
      expect(tx.payment.updateMany).toHaveBeenCalled();
    },
  );

  // El caso "nació PENDING y se confirmó después" NO tiene test acá a
  // propósito: a este método solo le llega el estado ACTUAL, así que un test
  // unitario de ese caso sería idéntico al de arriba y no podría fallar por su
  // propia razón. Quien lo prueba de verdad es el de integración
  // "un cobro confirmado DESPUÉS devuelve su monto", que pasa por
  // `PaymentsService.confirm` real y vería el crédito fantasma.

  it("varios cobros suman solo los que hoy están CONFIRMED", async () => {
    tx.sale.findFirst.mockResolvedValue(
      saleRow({
        total: decimal("30.00"),
        payments: [
          { id: "payment-confirmed", amount: decimal("12.00"), status: PaymentStatus.CONFIRMED },
          { id: "payment-pending", amount: decimal("8.00"), status: PaymentStatus.PENDING },
          { id: "payment-rejected", amount: decimal("5.00"), status: PaymentStatus.REJECTED },
        ],
      }),
    );

    const result = await service.voidStopDeliveryWithinTransaction(tx as never, voidParams());

    // -30.00 + 12.00, y nada de los otros dos.
    expect(result.debtDelta).toBe("-18.00");
    const [args] = firstCall<[{ where: unknown }]>(tx.payment.updateMany.mock.calls);
    expect(args.where).toEqual({
      id: { in: ["payment-confirmed", "payment-pending", "payment-rejected"] },
      voidedAt: null,
    });
  });

  it("emite la reversa de cada movimiento de la parada, fechada en la entrega original", async () => {
    tx.containerMovement.findMany.mockResolvedValue([
      movement(ContainerMovementType.LOAN_DELIVERY, 3),
      movement(ContainerMovementType.EMPTY_PICKUP, 2),
    ]);

    const result = await service.voidStopDeliveryWithinTransaction(tx as never, voidParams());

    expect(containerMovements.createWithinTransaction).toHaveBeenCalledWith(
      tx,
      {
        type: ContainerMovementType.LOAN_DELIVERY_VOID,
        containerTypeId: CONTAINER_TYPE_ID,
        quantity: 3,
        fromState: ContainerState.WITH_CUSTOMER,
        toState: ContainerState.FULL_ON_ROUTE,
        locationId: LOCATION_ID,
      },
      VOIDED_BY_ID,
      // occurredAt es el instante de la ENTREGA, no el de la corrección: la
      // reversa pertenece al día del hecho.
      { stopId: STOP_ID, occurredAt: SOLD_AT, routeId: ROUTE_ID },
    );
    expect(containerMovements.createWithinTransaction).toHaveBeenCalledWith(
      tx,
      {
        type: ContainerMovementType.EMPTY_PICKUP_VOID,
        containerTypeId: CONTAINER_TYPE_ID,
        quantity: 2,
        fromState: ContainerState.EMPTY_ON_ROUTE,
        toState: ContainerState.WITH_CUSTOMER,
        locationId: LOCATION_ID,
      },
      VOIDED_BY_ID,
      { stopId: STOP_ID, occurredAt: SOLD_AT, routeId: ROUTE_ID },
    );
    expect(result.voidMovements).toHaveLength(2);
  });

  it("los dos instantes son distintos: la venta se anula AHORA, la reversa se fecha en la entrega", async () => {
    tx.containerMovement.findMany.mockResolvedValue([
      movement(ContainerMovementType.LOAN_DELIVERY, 1),
    ]);
    const before = Date.now();

    await service.voidStopDeliveryWithinTransaction(tx as never, voidParams());

    const [saleArgs] = firstCall<[{ data: { voidedAt: Date } }]>(tx.sale.updateMany.mock.calls);
    const [, , , options] = firstCall<[unknown, unknown, unknown, { occurredAt: Date }]>(
      containerMovements.createWithinTransaction.mock.calls,
    );
    expect(saleArgs.data.voidedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(options.occurredAt).toBe(SOLD_AT);
    expect(options.occurredAt.getTime()).toBeLessThan(saleArgs.data.voidedAt.getTime());
  });

  it("FULL_SALE_VOID entra al parque sin origen: la clave fromState va omitida", async () => {
    tx.containerMovement.findMany.mockResolvedValue([movement(ContainerMovementType.FULL_SALE, 1)]);

    await service.voidStopDeliveryWithinTransaction(tx as never, voidParams());

    // Objeto exacto, no objectContaining: es lo único que prueba que la clave
    // está AUSENTE y no puesta en undefined (exactOptionalPropertyTypes).
    expect(containerMovements.createWithinTransaction).toHaveBeenCalledWith(
      tx,
      {
        type: ContainerMovementType.FULL_SALE_VOID,
        containerTypeId: CONTAINER_TYPE_ID,
        quantity: 1,
        toState: ContainerState.FULL_ON_ROUTE,
        locationId: LOCATION_ID,
      },
      VOIDED_BY_ID,
      { stopId: STOP_ID, occurredAt: SOLD_AT, routeId: ROUTE_ID },
    );
  });

  it("netea lo ya anulado: una segunda anulación solo revierte lo que quedó vigente", async () => {
    // La parada se corrigió una vez: 3 entregados, 3 anulados, y la
    // re-registración dejó 2 vigentes. Solo esos 2 pueden volver al camión.
    tx.containerMovement.findMany.mockResolvedValue([
      movement(ContainerMovementType.LOAN_DELIVERY, 3),
      movement(ContainerMovementType.LOAN_DELIVERY_VOID, 3),
      movement(ContainerMovementType.LOAN_DELIVERY, 2),
    ]);

    const result = await service.voidStopDeliveryWithinTransaction(tx as never, voidParams());

    expect(containerMovements.createWithinTransaction).toHaveBeenCalledTimes(1);
    expect(result.voidMovements).toEqual([
      {
        type: ContainerMovementType.LOAN_DELIVERY_VOID,
        containerTypeId: CONTAINER_TYPE_ID,
        quantity: 2,
      },
    ]);
  });

  it("un tipo enteramente anulado no emite nada: netear a cero no es emitir cero", async () => {
    tx.containerMovement.findMany.mockResolvedValue([
      movement(ContainerMovementType.EMPTY_PICKUP, 4),
      movement(ContainerMovementType.EMPTY_PICKUP_VOID, 4),
    ]);

    const result = await service.voidStopDeliveryWithinTransaction(tx as never, voidParams());

    expect(containerMovements.createWithinTransaction).not.toHaveBeenCalled();
    expect(result.voidMovements).toEqual([]);
  });

  it("netea por tipo de envase, no solo por tipo de movimiento", async () => {
    tx.containerMovement.findMany.mockResolvedValue([
      movement(ContainerMovementType.LOAN_DELIVERY, 3),
      movement(ContainerMovementType.LOAN_DELIVERY_VOID, 3),
      movement(ContainerMovementType.LOAN_DELIVERY, 5, OTHER_CONTAINER_TYPE_ID),
    ]);

    const result = await service.voidStopDeliveryWithinTransaction(tx as never, voidParams());

    // El tipo con caño quedó saldado; el otro sigue entero.
    expect(result.voidMovements).toEqual([
      {
        type: ContainerMovementType.LOAN_DELIVERY_VOID,
        containerTypeId: OTHER_CONTAINER_TYPE_ID,
        quantity: 5,
      },
    ]);
  });

  it("solo lee del ledger los tipos que sabe deshacer", async () => {
    await service.voidStopDeliveryWithinTransaction(tx as never, voidParams());

    const [args] = firstCall<
      [{ where: { stopId: string; type: { in: ContainerMovementType[] } } }]
    >(tx.containerMovement.findMany.mock.calls);
    expect(args.where.stopId).toBe(STOP_ID);
    expect([...args.where.type.in].sort()).toEqual(
      [
        ContainerMovementType.LOAN_DELIVERY,
        ContainerMovementType.LOAN_DELIVERY_VOID,
        ContainerMovementType.EMPTY_PICKUP,
        ContainerMovementType.EMPTY_PICKUP_VOID,
        ContainerMovementType.FULL_SALE,
        ContainerMovementType.FULL_SALE_VOID,
      ].sort(),
    );
    // ROUTE_LOAD, EMPTY_UNLOAD y los write-off no son de la parada y no se
    // deshacen acá: anular una entrega no descarga el camión.
    expect(args.where.type.in).not.toContain(ContainerMovementType.ROUTE_LOAD);
    expect(args.where.type.in).not.toContain(ContainerMovementType.EMPTY_UNLOAD);
  });
});
