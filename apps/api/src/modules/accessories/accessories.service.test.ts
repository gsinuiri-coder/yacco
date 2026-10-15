import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AccessoryMovementType, Prisma, ProductType } from "@prisma/client";
import { jest } from "@jest/globals";
import { PrismaService } from "../../prisma/prisma.service.js";
import { SalesService } from "../sales/sales.service.js";
import { AccessoriesService } from "./accessories.service.js";

const ACCESSORY_ID = "11111111-1111-4111-8111-111111111111";
const LOCATION_ID = "22222222-2222-4222-8222-222222222222";
const CUSTOMER_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";
const MOVEMENT_ID = "55555555-5555-4555-8555-555555555555";
const SALE_ID = "66666666-6666-4666-8666-666666666666";

function buildPrismaMock() {
  return {
    product: {
      findMany: jest.fn<() => Promise<unknown>>(),
      findUnique: jest.fn<() => Promise<unknown>>(),
    },
    accessoryStock: {
      findUnique: jest.fn<() => Promise<unknown>>(),
      upsert: jest.fn<() => Promise<unknown>>(),
    },
    customerAccessoryBalance: {
      findMany: jest.fn<() => Promise<unknown>>(),
      findUnique: jest.fn<() => Promise<unknown>>(),
      upsert: jest.fn<() => Promise<unknown>>(),
      update: jest.fn<() => Promise<unknown>>(),
    },
    accessoryMovement: {
      create: jest.fn<() => Promise<unknown>>(),
      findMany: jest.fn<() => Promise<unknown>>(),
      findUnique: jest.fn<() => Promise<unknown>>(),
      findFirst: jest.fn<() => Promise<unknown>>(),
      count: jest.fn<() => Promise<unknown>>(),
    },
    accessoryCount: {
      create: jest.fn<() => Promise<unknown>>(),
    },
    customerLocation: {
      findUnique: jest.fn<() => Promise<unknown>>(),
    },
    customerPrice: {
      findMany: jest.fn<() => Promise<unknown>>(),
    },
    customer: {
      update: jest.fn<() => Promise<unknown>>(),
    },
    sale: {
      create: jest.fn<() => Promise<unknown>>(),
      update: jest.fn<() => Promise<unknown>>(),
    },
    $transaction: jest.fn(),
  };
}

describe("AccessoriesService Unit Tests", () => {
  let service: AccessoriesService;
  let prisma: ReturnType<typeof buildPrismaMock>;
  let salesService: { voidSaleWithinTransaction: jest.Mock<() => Promise<unknown>> };

  beforeEach(async () => {
    prisma = buildPrismaMock();
    salesService = { voidSaleWithinTransaction: jest.fn<() => Promise<unknown>>() };
    prisma.$transaction.mockImplementation(async (callback) => {
      if (Array.isArray(callback)) {
        return Promise.all(callback);
      }
      return (callback as (transaction: typeof prisma) => Promise<unknown>)(prisma);
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        AccessoriesService,
        { provide: PrismaService, useValue: prisma },
        { provide: SalesService, useValue: salesService },
      ],
    }).compile();

    service = moduleRef.get(AccessoriesService);
  });

  describe("findAll", () => {
    it("returns accessories with stock and totalBorrowed", async () => {
      prisma.product.findMany.mockResolvedValue([
        {
          id: ACCESSORY_ID,
          name: "Dispensador",
          listPrice: new Prisma.Decimal("30.00"),
          active: true,
          accessoryStock: { quantity: 10 },
          customerAccessoryBalances: [{ quantity: 3 }, { quantity: 2 }],
        },
      ]);

      const result = await service.findAll();
      expect(result).toEqual([
        {
          id: ACCESSORY_ID,
          name: "Dispensador",
          listPrice: "30.00",
          active: true,
          stock: 10,
          totalBorrowed: 5,
        },
      ]);
    });
  });

  describe("createEntry", () => {
    it("throws if accessory does not exist", async () => {
      prisma.product.findUnique.mockResolvedValue(null);
      await expect(service.createEntry(ACCESSORY_ID, { quantity: 5 }, USER_ID)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("increments stock and creates ENTRY movement", async () => {
      prisma.product.findUnique.mockResolvedValue({
        id: ACCESSORY_ID,
        name: "Dispensador",
        type: ProductType.ACCESSORY,
      });

      const now = new Date();
      prisma.accessoryMovement.create.mockResolvedValue({
        id: MOVEMENT_ID,
        productId: ACCESSORY_ID,
        type: AccessoryMovementType.ENTRY,
        quantity: 5,
        locationId: null,
        location: null,
        saleId: null,
        reason: null,
        reversesMovementId: null,
        recordedById: USER_ID,
        recordedBy: { name: "Admin" },
        product: { name: "Dispensador" },
        occurredAt: now,
        createdAt: now,
      });

      const result = await service.createEntry(ACCESSORY_ID, { quantity: 5 }, USER_ID);
      expect(prisma.accessoryStock.upsert).toHaveBeenCalledWith({
        where: { productId: ACCESSORY_ID },
        update: { quantity: { increment: 5 } },
        create: { productId: ACCESSORY_ID, quantity: 5 },
      });
      expect(result.type).toBe(AccessoryMovementType.ENTRY);
      expect(result.quantity).toBe(5);
    });
  });

  describe("createWriteOff", () => {
    it("throws if reason is empty", async () => {
      prisma.product.findUnique.mockResolvedValue({
        id: ACCESSORY_ID,
        name: "Dispensador",
        type: ProductType.ACCESSORY,
      });

      await expect(
        service.createWriteOff(ACCESSORY_ID, { quantity: 2, reason: "   " }, USER_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it("decrements stock and creates WRITE_OFF movement", async () => {
      prisma.product.findUnique.mockResolvedValue({
        id: ACCESSORY_ID,
        name: "Dispensador",
        type: ProductType.ACCESSORY,
      });

      const now = new Date();
      prisma.accessoryMovement.create.mockResolvedValue({
        id: MOVEMENT_ID,
        productId: ACCESSORY_ID,
        type: AccessoryMovementType.WRITE_OFF,
        quantity: 2,
        locationId: null,
        location: null,
        saleId: null,
        reason: "Roto",
        reversesMovementId: null,
        recordedById: USER_ID,
        recordedBy: { name: "Admin" },
        product: { name: "Dispensador" },
        occurredAt: now,
        createdAt: now,
      });

      const result = await service.createWriteOff(
        ACCESSORY_ID,
        { quantity: 2, reason: "Roto" },
        USER_ID,
      );
      expect(prisma.accessoryStock.upsert).toHaveBeenCalledWith({
        where: { productId: ACCESSORY_ID },
        update: { quantity: { decrement: 2 } },
        create: { productId: ACCESSORY_ID, quantity: -2 },
      });
      expect(result.type).toBe(AccessoryMovementType.WRITE_OFF);
      expect(result.quantity).toBe(2);
    });
  });

  describe("count", () => {
    it("throws if discrepancy has no reason", async () => {
      prisma.product.findUnique.mockResolvedValue({
        id: ACCESSORY_ID,
        name: "Dispensador",
        type: ProductType.ACCESSORY,
      });
      prisma.accessoryStock.findUnique.mockResolvedValue({ quantity: 10 });

      await expect(
        service.count(ACCESSORY_ID, { countedQuantity: 8, reason: "" }, USER_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it("records adjustment movement when counted != expected", async () => {
      prisma.product.findUnique.mockResolvedValue({
        id: ACCESSORY_ID,
        name: "Dispensador",
        type: ProductType.ACCESSORY,
      });
      prisma.accessoryStock.findUnique.mockResolvedValue({ quantity: 10 });
      prisma.accessoryCount.create.mockResolvedValue({
        id: "count-1",
        productId: ACCESSORY_ID,
        expectedQty: 10,
        countedQty: 8,
        reason: "Faltante",
        recordedById: USER_ID,
        createdAt: new Date(),
      });

      const result = await service.count(
        ACCESSORY_ID,
        { countedQuantity: 8, reason: "Faltante" },
        USER_ID,
      );

      expect(prisma.accessoryStock.upsert).toHaveBeenCalledWith({
        where: { productId: ACCESSORY_ID },
        update: { quantity: 8 },
        create: { productId: ACCESSORY_ID, quantity: 8 },
      });
      expect(prisma.accessoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            productId: ACCESSORY_ID,
            type: AccessoryMovementType.COUNT_ADJUSTMENT,
            quantity: -2,
            reason: "Faltante",
          }),
        }),
      );
      expect(result.countedQty).toBe(8);
      expect(result.expectedQty).toBe(10);
    });

    it("does not emit adjustment movement when counted == expected", async () => {
      prisma.product.findUnique.mockResolvedValue({
        id: ACCESSORY_ID,
        name: "Dispensador",
        type: ProductType.ACCESSORY,
      });
      prisma.accessoryStock.findUnique.mockResolvedValue({ quantity: 8 });
      prisma.accessoryCount.create.mockResolvedValue({
        id: "count-2",
        productId: ACCESSORY_ID,
        expectedQty: 8,
        countedQty: 8,
        reason: null,
        recordedById: USER_ID,
        createdAt: new Date(),
      });

      const result = await service.count(ACCESSORY_ID, { countedQuantity: 8 }, USER_ID);
      expect(prisma.accessoryMovement.create).not.toHaveBeenCalled();
      expect(result.countedQty).toBe(8);
      expect(result.expectedQty).toBe(8);
    });
  });

  describe("loan and returnLoan", () => {
    it("loan decrements plant stock and increments customer location balance", async () => {
      prisma.customerLocation.findUnique.mockResolvedValue({
        id: LOCATION_ID,
        customerId: CUSTOMER_ID,
      });
      prisma.product.findUnique.mockResolvedValue({
        id: ACCESSORY_ID,
        name: "Dispensador",
        type: ProductType.ACCESSORY,
      });
      const now = new Date();
      prisma.accessoryMovement.create.mockResolvedValue({
        id: MOVEMENT_ID,
        productId: ACCESSORY_ID,
        type: AccessoryMovementType.LOAN,
        quantity: 2,
        locationId: LOCATION_ID,
        location: { name: "Sede Centro", customer: { name: "Cliente" } },
        saleId: null,
        reason: null,
        reversesMovementId: null,
        recordedById: USER_ID,
        recordedBy: { name: "Admin" },
        product: { name: "Dispensador" },
        occurredAt: now,
        createdAt: now,
      });

      const result = await service.loan(
        LOCATION_ID,
        { productId: ACCESSORY_ID, quantity: 2 },
        USER_ID,
      );

      expect(prisma.accessoryStock.upsert).toHaveBeenCalledWith({
        where: { productId: ACCESSORY_ID },
        update: { quantity: { decrement: 2 } },
        create: { productId: ACCESSORY_ID, quantity: -2 },
      });
      expect(prisma.customerAccessoryBalance.upsert).toHaveBeenCalledWith({
        where: {
          locationId_productId: { locationId: LOCATION_ID, productId: ACCESSORY_ID },
        },
        update: { quantity: { increment: 2 } },
        create: { locationId: LOCATION_ID, productId: ACCESSORY_ID, quantity: 2 },
      });
      expect(result.type).toBe(AccessoryMovementType.LOAN);
    });

    it("returnLoan throws if returning more than borrowed balance", async () => {
      prisma.customerLocation.findUnique.mockResolvedValue({ id: LOCATION_ID });
      prisma.product.findUnique.mockResolvedValue({
        id: ACCESSORY_ID,
        name: "Dispensador",
        type: ProductType.ACCESSORY,
      });
      prisma.customerAccessoryBalance.findUnique.mockResolvedValue({ quantity: 1 });

      await expect(
        service.returnLoan(LOCATION_ID, { productId: ACCESSORY_ID, quantity: 2 }, USER_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it("returnLoan decrements location balance and increments plant stock", async () => {
      prisma.customerLocation.findUnique.mockResolvedValue({ id: LOCATION_ID });
      prisma.product.findUnique.mockResolvedValue({
        id: ACCESSORY_ID,
        name: "Dispensador",
        type: ProductType.ACCESSORY,
      });
      prisma.customerAccessoryBalance.findUnique.mockResolvedValue({ quantity: 3 });
      const now = new Date();
      prisma.accessoryMovement.create.mockResolvedValue({
        id: MOVEMENT_ID,
        productId: ACCESSORY_ID,
        type: AccessoryMovementType.LOAN_RETURN,
        quantity: 2,
        locationId: LOCATION_ID,
        location: { name: "Sede Centro", customer: { name: "Cliente" } },
        saleId: null,
        reason: null,
        reversesMovementId: null,
        recordedById: USER_ID,
        recordedBy: { name: "Admin" },
        product: { name: "Dispensador" },
        occurredAt: now,
        createdAt: now,
      });

      const result = await service.returnLoan(
        LOCATION_ID,
        { productId: ACCESSORY_ID, quantity: 2 },
        USER_ID,
      );

      expect(prisma.customerAccessoryBalance.update).toHaveBeenCalledWith({
        where: {
          locationId_productId: { locationId: LOCATION_ID, productId: ACCESSORY_ID },
        },
        data: { quantity: { decrement: 2 } },
      });
      expect(prisma.accessoryStock.upsert).toHaveBeenCalledWith({
        where: { productId: ACCESSORY_ID },
        update: { quantity: { increment: 2 } },
        create: { productId: ACCESSORY_ID, quantity: 2 },
      });
      expect(result.type).toBe(AccessoryMovementType.LOAN_RETURN);
    });
  });

  describe("chargeLoan and voidCharge", () => {
    it("chargeLoan requires reason and throws if charging more than balance", async () => {
      await expect(
        service.chargeLoan(
          LOCATION_ID,
          { productId: ACCESSORY_ID, quantity: 1, reason: "" },
          USER_ID,
        ),
      ).rejects.toThrow(BadRequestException);

      prisma.customerLocation.findUnique.mockResolvedValue({
        id: LOCATION_ID,
        customerId: CUSTOMER_ID,
        customer: { id: CUSTOMER_ID, debtBalance: new Prisma.Decimal("0"), creditLimit: null },
      });
      prisma.product.findUnique.mockResolvedValue({
        id: ACCESSORY_ID,
        name: "Dispensador",
        type: ProductType.ACCESSORY,
        listPrice: new Prisma.Decimal("35.00"),
      });
      prisma.customerAccessoryBalance.findUnique.mockResolvedValue({ quantity: 1 });

      await expect(
        service.chargeLoan(
          LOCATION_ID,
          { productId: ACCESSORY_ID, quantity: 2, reason: "Perdido" },
          USER_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("chargeLoan creates Sale, increases customer debt, decrements balance, leaves plant stock untouched", async () => {
      prisma.customerLocation.findUnique.mockResolvedValue({
        id: LOCATION_ID,
        customerId: CUSTOMER_ID,
        customer: { id: CUSTOMER_ID, debtBalance: new Prisma.Decimal("0"), creditLimit: null },
      });
      prisma.product.findUnique.mockResolvedValue({
        id: ACCESSORY_ID,
        name: "Dispensador",
        type: ProductType.ACCESSORY,
        listPrice: new Prisma.Decimal("35.00"),
      });
      prisma.customerAccessoryBalance.findUnique.mockResolvedValue({ quantity: 2 });
      prisma.customerPrice.findMany.mockResolvedValue([]);
      prisma.sale.create.mockResolvedValue({ id: SALE_ID });
      const now = new Date();
      prisma.accessoryMovement.create.mockResolvedValue({
        id: MOVEMENT_ID,
        productId: ACCESSORY_ID,
        type: AccessoryMovementType.LOAN_CHARGE,
        quantity: 1,
        locationId: LOCATION_ID,
        location: { name: "Sede Centro", customer: { name: "Cliente" } },
        saleId: SALE_ID,
        reason: "Perdido",
        reversesMovementId: null,
        recordedById: USER_ID,
        recordedBy: { name: "Admin" },
        product: { name: "Dispensador" },
        occurredAt: now,
        createdAt: now,
      });

      const result = await service.chargeLoan(
        LOCATION_ID,
        { productId: ACCESSORY_ID, quantity: 1, reason: "Perdido" },
        USER_ID,
      );

      expect(prisma.customerAccessoryBalance.update).toHaveBeenCalledWith({
        where: {
          locationId_productId: { locationId: LOCATION_ID, productId: ACCESSORY_ID },
        },
        data: { quantity: { decrement: 1 } },
      });
      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: CUSTOMER_ID },
        data: { debtBalance: { increment: new Prisma.Decimal("35.00") } },
      });
      expect(prisma.accessoryStock.upsert).not.toHaveBeenCalled();
      expect(result.type).toBe(AccessoryMovementType.LOAN_CHARGE);
    });

    function loanChargeMovement(occurredAt: Date) {
      return {
        id: MOVEMENT_ID,
        productId: ACCESSORY_ID,
        type: AccessoryMovementType.LOAN_CHARGE,
        quantity: 1,
        locationId: LOCATION_ID,
        saleId: SALE_ID,
        occurredAt,
        sale: { id: SALE_ID, voidedAt: null },
        reversedBy: null,
      };
    }

    it("voidCharge voids the sale through SalesService, restores the balance, emits LOAN_CHARGE_VOID", async () => {
      const now = new Date();
      prisma.accessoryMovement.findUnique.mockResolvedValue(loanChargeMovement(now));
      salesService.voidSaleWithinTransaction.mockResolvedValue({
        sale: { id: SALE_ID, total: "35.00", soldAt: now },
        payments: [],
        debtDelta: "-35.00",
      });

      prisma.accessoryMovement.create.mockResolvedValue({
        id: "void-mov-id",
        productId: ACCESSORY_ID,
        type: AccessoryMovementType.LOAN_CHARGE_VOID,
        quantity: 1,
        locationId: LOCATION_ID,
        location: { name: "Sede Centro", customer: { name: "Cliente" } },
        saleId: SALE_ID,
        reason: "Corrección",
        reversesMovementId: MOVEMENT_ID,
        recordedById: USER_ID,
        recordedBy: { name: "Admin" },
        product: { name: "Dispensador" },
        occurredAt: now,
        createdAt: now,
      });

      const result = await service.voidCharge(MOVEMENT_ID, { reason: "Corrección" }, USER_ID);

      expect(salesService.voidSaleWithinTransaction).toHaveBeenCalledWith(prisma, {
        saleId: SALE_ID,
        voidedById: USER_ID,
        voidReason: "Corrección",
      });
      expect(prisma.sale.update).not.toHaveBeenCalled();
      expect(prisma.customer.update).not.toHaveBeenCalled();
      expect(prisma.customerAccessoryBalance.upsert).toHaveBeenCalledWith({
        where: {
          locationId_productId: { locationId: LOCATION_ID, productId: ACCESSORY_ID },
        },
        update: { quantity: { increment: 1 } },
        create: { locationId: LOCATION_ID, productId: ACCESSORY_ID, quantity: 1 },
      });
      expect(result.type).toBe(AccessoryMovementType.LOAN_CHARGE_VOID);
    });

    it("voidCharge leaves the balance alone when SalesService refuses or the sale is already void", async () => {
      prisma.accessoryMovement.findUnique.mockResolvedValue(loanChargeMovement(new Date()));
      salesService.voidSaleWithinTransaction.mockRejectedValue(
        new ConflictException("Anulá primero el comprobante vigente de la venta"),
      );
      await expect(
        service.voidCharge(MOVEMENT_ID, { reason: "Corrección" }, USER_ID),
      ).rejects.toThrow("Anulá primero el comprobante vigente de la venta");

      salesService.voidSaleWithinTransaction.mockResolvedValue({
        sale: null,
        payments: [],
        debtDelta: "0.00",
      });
      await expect(
        service.voidCharge(MOVEMENT_ID, { reason: "Corrección" }, USER_ID),
      ).rejects.toThrow("La venta asociada ya está anulada");
      expect(prisma.customerAccessoryBalance.upsert).not.toHaveBeenCalled();
      expect(prisma.accessoryMovement.create).not.toHaveBeenCalled();
    });
  });

  describe("listMovements", () => {
    it("throws BadRequestException if product is missing or not an accessory", async () => {
      prisma.product.findUnique.mockResolvedValue(null);
      await expect(service.listMovements("missing-id", {})).rejects.toThrow(BadRequestException);

      prisma.product.findUnique.mockResolvedValue({ id: "prod-1", type: ProductType.REFILL });
      await expect(service.listMovements("prod-1", {})).rejects.toThrow(BadRequestException);
    });

    it("paginates and filters movements by type, location, and date range", async () => {
      prisma.product.findUnique.mockResolvedValue({
        id: ACCESSORY_ID,
        type: ProductType.ACCESSORY,
      });
      const now = new Date();
      prisma.accessoryMovement.count.mockResolvedValue(1);
      prisma.accessoryMovement.findMany.mockResolvedValue([
        {
          id: MOVEMENT_ID,
          productId: ACCESSORY_ID,
          type: AccessoryMovementType.ENTRY,
          quantity: 5,
          locationId: null,
          location: null,
          saleId: null,
          reason: null,
          reversesMovementId: null,
          recordedById: USER_ID,
          recordedBy: { name: "Admin" },
          product: { name: "Dispensador" },
          occurredAt: now,
          createdAt: now,
        },
      ]);

      const result = await service.listMovements(ACCESSORY_ID, {
        page: 2,
        limit: 10,
        type: AccessoryMovementType.ENTRY,
        locationId: LOCATION_ID,
        startDate: "2026-10-01",
        endDate: "2026-10-10",
      });

      expect(result.page).toBe(2);
      expect(result.limit).toBe(10);
      expect(result.total).toBe(1);
      expect(result.totalPages).toBe(1);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]?.type).toBe(AccessoryMovementType.ENTRY);
    });
  });

  describe("listCustomerBalances", () => {
    it("throws NotFoundException if location does not exist", async () => {
      prisma.customerLocation.findUnique.mockResolvedValue(null);
      await expect(service.listCustomerBalances("missing-loc")).rejects.toThrow();
    });

    it("returns location balances with agreed prices resolving location price first", async () => {
      prisma.customerLocation.findUnique.mockResolvedValue({
        id: LOCATION_ID,
        customerId: CUSTOMER_ID,
      });
      prisma.customerAccessoryBalance.findMany.mockResolvedValue([
        {
          locationId: LOCATION_ID,
          productId: ACCESSORY_ID,
          quantity: 3,
          product: {
            id: ACCESSORY_ID,
            name: "Dispensador",
            listPrice: new Prisma.Decimal("40.00"),
          },
        },
      ]);
      prisma.customerPrice.findMany.mockResolvedValue([
        {
          customerId: CUSTOMER_ID,
          productId: ACCESSORY_ID,
          locationId: LOCATION_ID,
          price: new Prisma.Decimal("35.00"),
        },
      ]);

      const balances = await service.listCustomerBalances(LOCATION_ID);
      expect(balances).toHaveLength(1);
      expect(balances[0]?.agreedPrice).toBe("35.00");
      expect(balances[0]?.listPrice).toBe("40.00");
    });
  });

  describe("getBorrowedReport", () => {
    it("returns list of borrowed accessories across customer locations", async () => {
      const now = new Date();
      prisma.customerAccessoryBalance.findMany.mockResolvedValue([
        {
          locationId: LOCATION_ID,
          productId: ACCESSORY_ID,
          quantity: 2,
          location: {
            name: "Sede Centro",
            customer: { id: CUSTOMER_ID, name: "Bodega Don Pepe" },
          },
          product: { id: ACCESSORY_ID, name: "Dispensador" },
        },
      ]);
      prisma.accessoryMovement.findFirst.mockResolvedValue({
        occurredAt: now,
      });

      const report = await service.getBorrowedReport();
      expect(report).toHaveLength(1);
      expect(report[0]?.customerName).toBe("Bodega Don Pepe");
      expect(report[0]?.quantity).toBe(2);
      expect(report[0]?.lastMovementAt).toEqual(now);
    });
  });

  describe("reconciliation", () => {
    it("reports balanced when ledger matches stock and balances", async () => {
      prisma.product.findMany.mockResolvedValue([
        {
          id: ACCESSORY_ID,
          name: "Dispensador",
          accessoryStock: { quantity: 10 },
        },
      ]);
      prisma.accessoryMovement.findMany
        .mockResolvedValueOnce([
          { type: AccessoryMovementType.ENTRY, quantity: 15 },
          { type: AccessoryMovementType.LOAN, quantity: 5 },
        ])
        .mockResolvedValueOnce([{ type: AccessoryMovementType.LOAN, quantity: 5 }]);

      prisma.customerAccessoryBalance.findMany.mockResolvedValue([
        {
          locationId: LOCATION_ID,
          productId: ACCESSORY_ID,
          quantity: 5,
          location: { name: "Sede Centro" },
          product: { name: "Dispensador" },
        },
      ]);

      const result = await service.reconciliation();
      expect(result.isBalanced).toBe(true);
      expect(result.stockDiscrepancies).toHaveLength(0);
      expect(result.customerBalanceDiscrepancies).toHaveLength(0);
    });

    it("detects discrepancies across various movement types", async () => {
      prisma.product.findMany.mockResolvedValue([
        {
          id: ACCESSORY_ID,
          name: "Dispensador",
          accessoryStock: { quantity: 10 },
        },
      ]);
      prisma.accessoryMovement.findMany
        .mockResolvedValueOnce([
          { type: AccessoryMovementType.ENTRY, quantity: 20 },
          { type: AccessoryMovementType.SALE, quantity: 2 },
          { type: AccessoryMovementType.SALE_VOID, quantity: 1 },
          { type: AccessoryMovementType.LOAN, quantity: 5 },
          { type: AccessoryMovementType.LOAN_RETURN, quantity: 2 },
          { type: AccessoryMovementType.LOAN_RETURN_VOID, quantity: 1 },
          { type: AccessoryMovementType.LOAN_VOID, quantity: 1 },
          { type: AccessoryMovementType.WRITE_OFF, quantity: 2 },
          { type: AccessoryMovementType.COUNT_ADJUSTMENT, quantity: -2 },
          { type: AccessoryMovementType.LOAN_CHARGE, quantity: 1 },
          { type: AccessoryMovementType.LOAN_CHARGE_VOID, quantity: 1 },
        ])
        .mockResolvedValueOnce([
          { type: AccessoryMovementType.LOAN, quantity: 5 },
          { type: AccessoryMovementType.LOAN_VOID, quantity: 1 },
          { type: AccessoryMovementType.LOAN_RETURN, quantity: 1 },
          { type: AccessoryMovementType.LOAN_RETURN_VOID, quantity: 1 },
          { type: AccessoryMovementType.LOAN_CHARGE, quantity: 1 },
          { type: AccessoryMovementType.LOAN_CHARGE_VOID, quantity: 1 },
          { type: AccessoryMovementType.ENTRY, quantity: 10 },
          { type: AccessoryMovementType.SALE, quantity: 2 },
          { type: AccessoryMovementType.SALE_VOID, quantity: 1 },
          { type: AccessoryMovementType.WRITE_OFF, quantity: 1 },
          { type: AccessoryMovementType.COUNT_ADJUSTMENT, quantity: 1 },
        ]);

      prisma.customerAccessoryBalance.findMany.mockResolvedValue([
        {
          locationId: LOCATION_ID,
          productId: ACCESSORY_ID,
          quantity: 1, // differs from ledger
          location: { name: "Sede Centro" },
          product: { name: "Dispensador" },
        },
      ]);

      const result = await service.reconciliation();
      expect(result.isBalanced).toBe(false);
      expect(result.stockDiscrepancies.length).toBeGreaterThan(0);
      expect(result.customerBalanceDiscrepancies.length).toBeGreaterThan(0);
    });
  });

  describe("voidCharge edge cases", () => {
    it("throws if movement is not found or not LOAN_CHARGE or already reversed", async () => {
      prisma.accessoryMovement.findUnique.mockResolvedValue(null);
      await expect(service.voidCharge("missing", { reason: "test" }, USER_ID)).rejects.toThrow(
        NotFoundException,
      );

      prisma.accessoryMovement.findUnique.mockResolvedValue({
        id: "mov-1",
        type: AccessoryMovementType.ENTRY,
      });
      await expect(service.voidCharge("mov-1", { reason: "test" }, USER_ID)).rejects.toThrow(
        BadRequestException,
      );

      prisma.accessoryMovement.findUnique.mockResolvedValue({
        id: "mov-2",
        type: AccessoryMovementType.LOAN_CHARGE,
        sale: { voidedAt: new Date() },
      });
      await expect(service.voidCharge("mov-2", { reason: "test" }, USER_ID)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
