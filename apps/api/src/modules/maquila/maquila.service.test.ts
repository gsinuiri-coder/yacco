import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { MaquilaMovementType, PaymentStatus, Prisma, UserRole } from "@prisma/client";
import { jest } from "@jest/globals";
import { PrismaService } from "../../prisma/prisma.service.js";
import { SalesService } from "../sales/sales.service.js";
import { MaquilaService } from "./maquila.service.js";

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";
const CONTAINER_TYPE_ID = "22222222-2222-4222-8222-222222222222";
const LOCATION_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";
const PRODUCT_ID = "55555555-5555-4555-8555-555555555555";
const PAYMENT_METHOD_ID = "66666666-6666-4666-8666-666666666666";
const MOVEMENT_ID = "77777777-7777-4777-8777-777777777777";
const SALE_ID = "88888888-8888-4888-8888-888888888888";

function buildPrismaMock() {
  return {
    customer: {
      findUnique: jest.fn<() => Promise<unknown>>(),
      update: jest.fn<() => Promise<unknown>>(),
    },
    containerType: {
      findUnique: jest.fn<() => Promise<unknown>>(),
    },
    product: {
      findFirst: jest.fn<() => Promise<unknown>>(),
      findMany: jest.fn<() => Promise<unknown>>(),
    },
    customerLocation: {
      findFirst: jest.fn<() => Promise<unknown>>(),
      findUnique: jest.fn<() => Promise<unknown>>(),
    },
    customerPrice: {
      findMany: jest.fn<() => Promise<unknown>>(),
    },
    paymentMethod: {
      findUnique: jest.fn<() => Promise<unknown>>(),
    },
    maquilaBalance: {
      findUnique: jest.fn<() => Promise<unknown>>(),
      findMany: jest.fn<() => Promise<unknown>>(),
      upsert: jest.fn<() => Promise<unknown>>(),
      update: jest.fn<() => Promise<unknown>>(),
      updateMany: jest.fn<() => Promise<unknown>>(),
    },
    maquilaContainerMovement: {
      create: jest.fn<() => Promise<unknown>>(),
      findUnique: jest.fn<() => Promise<unknown>>(),
      findMany: jest.fn<() => Promise<unknown>>(),
      count: jest.fn<() => Promise<unknown>>(),
    },
    sale: {
      create: jest.fn<() => Promise<unknown>>(),
      update: jest.fn<() => Promise<unknown>>(),
    },
    payment: {
      create: jest.fn<() => Promise<unknown>>(),
      updateMany: jest.fn<() => Promise<unknown>>(),
    },
    $transaction: jest.fn((callbackOrArray: unknown) => {
      if (typeof callbackOrArray === "function") {
        return (callbackOrArray as (tx: unknown) => Promise<unknown>)(prisma);
      }
      return Promise.all(callbackOrArray as Promise<unknown>[]);
    }),
  };
}

function buildSalesMock() {
  return {
    registerServiceSaleWithinTransaction: jest.fn<() => Promise<unknown>>(),
    voidSaleWithinTransaction: jest.fn<() => Promise<unknown>>(),
  };
}

let prisma: ReturnType<typeof buildPrismaMock>;
let sales: ReturnType<typeof buildSalesMock>;

describe("MaquilaService Unit Tests", () => {
  let service: MaquilaService;

  beforeEach(async () => {
    prisma = buildPrismaMock();
    prisma.maquilaBalance.updateMany.mockResolvedValue({ count: 1 });
    sales = buildSalesMock();

    const moduleRef = await Test.createTestingModule({
      providers: [
        MaquilaService,
        { provide: PrismaService, useValue: prisma },
        { provide: SalesService, useValue: sales },
      ],
    }).compile();

    service = moduleRef.get(MaquilaService);
  });

  describe("receive", () => {
    it("debe registrar recepción exitosamente y aumentar vacíos en planta", async () => {
      prisma.customer.findUnique.mockResolvedValue({ id: CUSTOMER_ID, active: true });
      prisma.containerType.findUnique.mockResolvedValue({ id: CONTAINER_TYPE_ID, active: true });

      const mockMovement = {
        id: MOVEMENT_ID,
        customerId: CUSTOMER_ID,
        containerTypeId: CONTAINER_TYPE_ID,
        type: MaquilaMovementType.RECEIVED,
        quantity: 10,
        saleId: null,
        reversesMovementId: null,
        reason: null,
        recordedById: USER_ID,
        occurredAt: new Date(),
        createdAt: new Date(),
        customer: { id: CUSTOMER_ID, name: "Cliente Maquila S.A." },
        containerType: { id: CONTAINER_TYPE_ID, name: "Con caño" },
        recordedBy: { id: USER_ID, name: "Vendedor" },
        sale: null,
      };

      prisma.maquilaBalance.upsert.mockResolvedValue({
        customerId: CUSTOMER_ID,
        containerTypeId: CONTAINER_TYPE_ID,
        emptyAtPlant: 10,
        fullToReturn: 0,
      });
      prisma.maquilaContainerMovement.create.mockResolvedValue(mockMovement);

      const result = await service.receive(
        { customerId: CUSTOMER_ID, containerTypeId: CONTAINER_TYPE_ID, quantity: 10 },
        USER_ID,
      );

      expect(result.quantity).toBe(10);
      expect(result.type).toBe(MaquilaMovementType.RECEIVED);
      expect(prisma.maquilaBalance.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { emptyAtPlant: { increment: 10 } },
        }),
      );
    });

    it("debe rechazar si el cliente no existe o no está activo", async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      await expect(
        service.receive(
          { customerId: CUSTOMER_ID, containerTypeId: CONTAINER_TYPE_ID, quantity: 5 },
          USER_ID,
        ),
      ).rejects.toThrow(BadRequestException);

      prisma.customer.findUnique.mockResolvedValue({ id: CUSTOMER_ID, active: false });
      await expect(
        service.receive(
          { customerId: CUSTOMER_ID, containerTypeId: CONTAINER_TYPE_ID, quantity: 5 },
          USER_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("debe rechazar si el tipo de envase no existe o no está activo", async () => {
      prisma.customer.findUnique.mockResolvedValue({ id: CUSTOMER_ID, active: true });
      prisma.containerType.findUnique.mockResolvedValue(null);

      await expect(
        service.receive(
          { customerId: CUSTOMER_ID, containerTypeId: CONTAINER_TYPE_ID, quantity: 5 },
          USER_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("fill", () => {
    it("debe registrar llenado descontando vacíos y sumando llenos por devolver", async () => {
      prisma.customer.findUnique.mockResolvedValue({ id: CUSTOMER_ID, active: true });
      prisma.containerType.findUnique.mockResolvedValue({ id: CONTAINER_TYPE_ID, active: true });
      prisma.maquilaBalance.findUnique.mockResolvedValue({ emptyAtPlant: 10 });

      const mockMovement = {
        id: MOVEMENT_ID,
        customerId: CUSTOMER_ID,
        containerTypeId: CONTAINER_TYPE_ID,
        type: MaquilaMovementType.FILLED,
        quantity: 6,
        saleId: null,
        reversesMovementId: null,
        reason: null,
        recordedById: USER_ID,
        occurredAt: new Date(),
        createdAt: new Date(),
        customer: { id: CUSTOMER_ID, name: "Cliente Maquila S.A." },
        containerType: { id: CONTAINER_TYPE_ID, name: "Con caño" },
        recordedBy: { id: USER_ID, name: "Operador" },
        sale: null,
      };

      prisma.maquilaBalance.update.mockResolvedValue({
        customerId: CUSTOMER_ID,
        containerTypeId: CONTAINER_TYPE_ID,
        emptyAtPlant: 4,
        fullToReturn: 6,
      });
      prisma.maquilaContainerMovement.create.mockResolvedValue(mockMovement);

      const result = await service.fill(
        { customerId: CUSTOMER_ID, containerTypeId: CONTAINER_TYPE_ID, quantity: 6 },
        USER_ID,
      );

      expect(result.quantity).toBe(6);
      expect(result.type).toBe(MaquilaMovementType.FILLED);
      expect(prisma.maquilaBalance.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ emptyAtPlant: { gte: 6 } }),
          data: {
            emptyAtPlant: { decrement: 6 },
            fullToReturn: { increment: 6 },
          },
        }),
      );
    });

    it("debe rechazar si se intenta llenar más de los vacíos en planta", async () => {
      prisma.customer.findUnique.mockResolvedValue({ id: CUSTOMER_ID, active: true });
      prisma.containerType.findUnique.mockResolvedValue({ id: CONTAINER_TYPE_ID, active: true });
      prisma.maquilaBalance.findUnique.mockResolvedValue({ emptyAtPlant: 5 });

      await expect(
        service.fill(
          { customerId: CUSTOMER_ID, containerTypeId: CONTAINER_TYPE_ID, quantity: 7 },
          USER_ID,
        ),
      ).rejects.toThrow(
        "No hay suficientes vacíos en planta para llenar (hay 5, se intentó llenar 7)",
      );
    });

    it("rechaza con mensaje de dominio si otro llenado consume el saldo primero", async () => {
      prisma.customer.findUnique.mockResolvedValue({ id: CUSTOMER_ID, active: true });
      prisma.containerType.findUnique.mockResolvedValue({ id: CONTAINER_TYPE_ID, active: true });
      prisma.maquilaBalance.findUnique.mockResolvedValue({ emptyAtPlant: 1 });
      prisma.maquilaBalance.updateMany.mockResolvedValue({ count: 0 });
      prisma.maquilaBalance.update.mockResolvedValue({});
      prisma.maquilaContainerMovement.create.mockResolvedValue({
        id: MOVEMENT_ID,
        customerId: CUSTOMER_ID,
        containerTypeId: CONTAINER_TYPE_ID,
        type: MaquilaMovementType.FILLED,
        quantity: 1,
        saleId: null,
        reversesMovementId: null,
        reason: null,
        recordedById: USER_ID,
        occurredAt: new Date(),
        createdAt: new Date(),
        customer: { id: CUSTOMER_ID, name: "Cliente" },
        containerType: { id: CONTAINER_TYPE_ID, name: "Con caño" },
        recordedBy: { id: USER_ID, name: "Operador" },
        sale: null,
      });

      await expect(
        service.fill(
          { customerId: CUSTOMER_ID, containerTypeId: CONTAINER_TYPE_ID, quantity: 1 },
          USER_ID,
        ),
      ).rejects.toThrow("No hay suficientes vacíos en planta para llenar");

      expect(prisma.maquilaBalance.updateMany).toHaveBeenCalled();
      expect(prisma.maquilaContainerMovement.create).not.toHaveBeenCalled();
    });
  });

  describe("return", () => {
    it("debe rechazar una ubicación que pertenece a otro cliente", async () => {
      prisma.customer.findUnique.mockResolvedValue({ id: CUSTOMER_ID, active: true });
      prisma.containerType.findUnique.mockResolvedValue({ id: CONTAINER_TYPE_ID, active: true });
      prisma.maquilaBalance.findUnique.mockResolvedValue({ fullToReturn: 4 });
      prisma.product.findFirst.mockResolvedValue({ id: PRODUCT_ID });
      prisma.customerLocation.findUnique.mockResolvedValue({
        id: LOCATION_ID,
        customerId: "99999999-9999-4999-8999-999999999999",
        active: true,
      });

      await expect(
        service.return(
          {
            customerId: CUSTOMER_ID,
            containerTypeId: CONTAINER_TYPE_ID,
            quantity: 4,
            locationId: LOCATION_ID,
          },
          USER_ID,
        ),
      ).rejects.toThrow(`La ubicación "${LOCATION_ID}" no pertenece a este cliente`);

      expect(sales.registerServiceSaleWithinTransaction).not.toHaveBeenCalled();
      expect(prisma.maquilaBalance.update).not.toHaveBeenCalled();
    });

    it("debe rechazar si falta el precio de maquila", async () => {
      prisma.customer.findUnique.mockResolvedValue({
        id: CUSTOMER_ID,
        active: true,
        debtBalance: new Prisma.Decimal("0.00"),
        creditLimit: null,
      });
      prisma.containerType.findUnique.mockResolvedValue({ id: CONTAINER_TYPE_ID, active: true });
      prisma.maquilaBalance.findUnique.mockResolvedValue({ fullToReturn: 10 });
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(
        service.return(
          { customerId: CUSTOMER_ID, containerTypeId: CONTAINER_TYPE_ID, quantity: 4 },
          USER_ID,
        ),
      ).rejects.toThrow("Falta el precio de maquila de este cliente");
    });

    it("debe rechazar devolver más de lo llenado", async () => {
      prisma.customer.findUnique.mockResolvedValue({
        id: CUSTOMER_ID,
        active: true,
        debtBalance: new Prisma.Decimal("0.00"),
        creditLimit: null,
      });
      prisma.containerType.findUnique.mockResolvedValue({ id: CONTAINER_TYPE_ID, active: true });
      prisma.maquilaBalance.findUnique.mockResolvedValue({ fullToReturn: 3 });

      await expect(
        service.return(
          { customerId: CUSTOMER_ID, containerTypeId: CONTAINER_TYPE_ID, quantity: 5 },
          USER_ID,
        ),
      ).rejects.toThrow("No hay suficientes llenos para devolver (hay 3, se intentó devolver 5)");
    });

    it("rechaza con mensaje de dominio si otra devolución consume el saldo primero", async () => {
      prisma.customer.findUnique.mockResolvedValue({ id: CUSTOMER_ID, active: true });
      prisma.containerType.findUnique.mockResolvedValue({ id: CONTAINER_TYPE_ID, active: true });
      prisma.maquilaBalance.findUnique.mockResolvedValue({ fullToReturn: 1 });
      prisma.maquilaBalance.updateMany.mockResolvedValue({ count: 0 });
      prisma.maquilaBalance.update.mockResolvedValue({});
      prisma.product.findFirst.mockResolvedValue({ id: PRODUCT_ID });
      prisma.customerLocation.findUnique.mockResolvedValue({
        id: LOCATION_ID,
        customerId: CUSTOMER_ID,
        active: true,
      });
      sales.registerServiceSaleWithinTransaction.mockResolvedValue({ sale: { id: SALE_ID } });
      prisma.maquilaContainerMovement.create.mockResolvedValue({
        id: MOVEMENT_ID,
        customerId: CUSTOMER_ID,
        containerTypeId: CONTAINER_TYPE_ID,
        type: MaquilaMovementType.RETURNED,
        quantity: 1,
        saleId: SALE_ID,
        reversesMovementId: null,
        reason: null,
        recordedById: USER_ID,
        occurredAt: new Date(),
        createdAt: new Date(),
        customer: { id: CUSTOMER_ID, name: "Cliente" },
        containerType: { id: CONTAINER_TYPE_ID, name: "Con caño" },
        recordedBy: { id: USER_ID, name: "Vendedor" },
        sale: { id: SALE_ID, total: new Prisma.Decimal("3.50") },
      });

      await expect(
        service.return(
          {
            customerId: CUSTOMER_ID,
            containerTypeId: CONTAINER_TYPE_ID,
            quantity: 1,
            locationId: LOCATION_ID,
          },
          USER_ID,
        ),
      ).rejects.toThrow("No hay suficientes llenos para devolver");

      expect(prisma.maquilaBalance.updateMany).toHaveBeenCalled();
      expect(sales.registerServiceSaleWithinTransaction).not.toHaveBeenCalled();
    });

    it("debe devolver con precio pactado y pago confirmado", async () => {
      prisma.customer.findUnique.mockResolvedValue({
        id: CUSTOMER_ID,
        active: true,
        debtBalance: new Prisma.Decimal("0.00"),
        creditLimit: null,
      });
      prisma.containerType.findUnique.mockResolvedValue({ id: CONTAINER_TYPE_ID, active: true });
      prisma.maquilaBalance.findUnique.mockResolvedValue({ fullToReturn: 6 });
      prisma.product.findFirst.mockResolvedValue({
        id: PRODUCT_ID,
        listPrice: new Prisma.Decimal("3.00"),
      });
      prisma.customerLocation.findFirst.mockResolvedValue({ id: LOCATION_ID });
      prisma.customerPrice.findMany.mockResolvedValue([
        { locationId: null, price: new Prisma.Decimal("2.50") },
      ]);
      prisma.paymentMethod.findUnique.mockResolvedValue({
        id: PAYMENT_METHOD_ID,
        active: true,
        requiresConfirmation: false,
      });

      prisma.sale.create.mockResolvedValue({
        id: SALE_ID,
        total: new Prisma.Decimal("10.00"),
      });
      prisma.payment.create.mockResolvedValue({ id: "pay-1" });
      prisma.maquilaBalance.update.mockResolvedValue({});
      prisma.customer.update.mockResolvedValue({});
      sales.registerServiceSaleWithinTransaction.mockResolvedValue({
        sale: { id: SALE_ID, total: "10.00", creditLimitExceeded: false },
        payment: { id: "pay-1", amount: "10.00", status: PaymentStatus.CONFIRMED },
      });

      const mockMovement = {
        id: MOVEMENT_ID,
        customerId: CUSTOMER_ID,
        containerTypeId: CONTAINER_TYPE_ID,
        type: MaquilaMovementType.RETURNED,
        quantity: 4,
        saleId: SALE_ID,
        reversesMovementId: null,
        reason: null,
        recordedById: USER_ID,
        occurredAt: new Date(),
        createdAt: new Date(),
        customer: { id: CUSTOMER_ID, name: "Cliente Maquila S.A." },
        containerType: { id: CONTAINER_TYPE_ID, name: "Con caño" },
        recordedBy: { id: USER_ID, name: "Administrador" },
        sale: { id: SALE_ID, total: new Prisma.Decimal("10.00") },
      };
      prisma.maquilaContainerMovement.create.mockResolvedValue(mockMovement);

      const result = await service.return(
        {
          customerId: CUSTOMER_ID,
          containerTypeId: CONTAINER_TYPE_ID,
          quantity: 4,
          payment: { paymentMethodId: PAYMENT_METHOD_ID, amount: "10.00" },
        },
        USER_ID,
      );

      expect(result.quantity).toBe(4);
      expect(result.type).toBe(MaquilaMovementType.RETURNED);
      expect(result.saleTotal).toBe("10.00");
      expect(sales.registerServiceSaleWithinTransaction).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          locationId: LOCATION_ID,
          productId: PRODUCT_ID,
          quantity: 4,
          payment: { paymentMethodId: PAYMENT_METHOD_ID, amount: "10.00" },
          recordedById: USER_ID,
        }),
      );
      expect(prisma.sale.create).not.toHaveBeenCalled();
      expect(prisma.payment.create).not.toHaveBeenCalled();
      expect(prisma.customer.update).not.toHaveBeenCalled();
    });
  });

  describe("voidMovement", () => {
    it("anular devuelto debe anular la venta y restaurar saldos y deuda", async () => {
      const mockReturnedMovement = {
        id: MOVEMENT_ID,
        customerId: CUSTOMER_ID,
        containerTypeId: CONTAINER_TYPE_ID,
        type: MaquilaMovementType.RETURNED,
        quantity: 4,
        saleId: SALE_ID,
        reversesMovementId: null,
        reversedBy: null,
        sale: {
          id: SALE_ID,
          total: new Prisma.Decimal("10.00"),
          voidedAt: null,
          payments: [
            {
              id: "pay-1",
              amount: new Prisma.Decimal("10.00"),
              status: PaymentStatus.CONFIRMED,
            },
          ],
          location: { customerId: CUSTOMER_ID },
        },
      };

      prisma.maquilaContainerMovement.findUnique.mockResolvedValue(mockReturnedMovement);
      prisma.maquilaBalance.update.mockResolvedValue({});
      prisma.sale.update.mockResolvedValue({});
      prisma.payment.updateMany.mockResolvedValue({});
      prisma.customer.update.mockResolvedValue({});
      sales.voidSaleWithinTransaction.mockResolvedValue({
        sale: { id: SALE_ID, total: "10.00", soldAt: new Date() },
        payments: [{ id: "pay-1", amount: "10.00", status: PaymentStatus.CONFIRMED }],
        debtDelta: "0.00",
      });

      const mockVoidMovement = {
        id: "void-mov-1",
        customerId: CUSTOMER_ID,
        containerTypeId: CONTAINER_TYPE_ID,
        type: MaquilaMovementType.RETURNED_VOID,
        quantity: 4,
        saleId: SALE_ID,
        reversesMovementId: MOVEMENT_ID,
        reason: "Devolución cancelada",
        recordedById: USER_ID,
        occurredAt: new Date(),
        createdAt: new Date(),
        customer: { id: CUSTOMER_ID, name: "Cliente Maquila S.A." },
        containerType: { id: CONTAINER_TYPE_ID, name: "Con caño" },
        recordedBy: { id: USER_ID, name: "Admin" },
        sale: { id: SALE_ID, total: new Prisma.Decimal("10.00") },
      };
      prisma.maquilaContainerMovement.create.mockResolvedValue(mockVoidMovement);

      const result = await service.voidMovement(
        MOVEMENT_ID,
        { reason: "Devolución cancelada" },
        { id: USER_ID, roles: [UserRole.ADMIN] },
      );

      expect(result.type).toBe(MaquilaMovementType.RETURNED_VOID);
      expect(prisma.maquilaBalance.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { fullToReturn: { increment: 4 } },
        }),
      );
      expect(sales.voidSaleWithinTransaction).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          saleId: SALE_ID,
          voidedById: USER_ID,
          voidReason: "Devolución cancelada",
        }),
      );
      expect(prisma.sale.update).not.toHaveBeenCalled();
      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
      expect(prisma.customer.update).not.toHaveBeenCalled();
    });

    it("no permite anular devuelto a un no administrador", async () => {
      const mockReturnedMovement = {
        id: MOVEMENT_ID,
        customerId: CUSTOMER_ID,
        containerTypeId: CONTAINER_TYPE_ID,
        type: MaquilaMovementType.RETURNED,
        quantity: 4,
        reversedBy: null,
      };

      prisma.maquilaContainerMovement.findUnique.mockResolvedValue(mockReturnedMovement);

      await expect(
        service.voidMovement(
          MOVEMENT_ID,
          { reason: "Motivo" },
          { id: USER_ID, roles: [UserRole.SELLER] },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it("convierte una anulación concurrente duplicada en un rechazo de dominio", async () => {
      prisma.maquilaContainerMovement.findUnique.mockResolvedValue({
        id: MOVEMENT_ID,
        customerId: CUSTOMER_ID,
        containerTypeId: CONTAINER_TYPE_ID,
        type: MaquilaMovementType.RECEIVED,
        quantity: 1,
        reversedBy: null,
      });
      prisma.maquilaBalance.findUnique.mockResolvedValue({ emptyAtPlant: 1 });
      prisma.$transaction.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError("duplicate reversal", {
          code: "P2002",
          clientVersion: "test",
        }),
      );

      await expect(
        service.voidMovement(
          MOVEMENT_ID,
          { reason: "Duplicada" },
          { id: USER_ID, roles: [UserRole.ADMIN] },
        ),
      ).rejects.toThrow("El movimiento ya ha sido anulado previamente");
    });

    it("no permite anular llenado si los llenos por devolver quedarían en negativo", async () => {
      const mockFilledMovement = {
        id: MOVEMENT_ID,
        customerId: CUSTOMER_ID,
        containerTypeId: CONTAINER_TYPE_ID,
        type: MaquilaMovementType.FILLED,
        quantity: 6,
        reversedBy: null,
      };

      prisma.maquilaContainerMovement.findUnique.mockResolvedValue(mockFilledMovement);
      prisma.maquilaBalance.findUnique.mockResolvedValue({ fullToReturn: 2 });

      await expect(
        service.voidMovement(
          MOVEMENT_ID,
          { reason: "Motivo" },
          { id: USER_ID, roles: [UserRole.ADMIN] },
        ),
      ).rejects.toThrow(
        "No se puede anular el llenado: los llenos por devolver quedarían en negativo",
      );
    });

    it("no permite anular recibido si los vacíos en planta quedarían en negativo", async () => {
      const mockReceivedMovement = {
        id: MOVEMENT_ID,
        customerId: CUSTOMER_ID,
        containerTypeId: CONTAINER_TYPE_ID,
        type: MaquilaMovementType.RECEIVED,
        quantity: 10,
        reversedBy: null,
      };

      prisma.maquilaContainerMovement.findUnique.mockResolvedValue(mockReceivedMovement);
      prisma.maquilaBalance.findUnique.mockResolvedValue({ emptyAtPlant: 3 });

      await expect(
        service.voidMovement(
          MOVEMENT_ID,
          { reason: "Motivo" },
          { id: USER_ID, roles: [UserRole.ADMIN] },
        ),
      ).rejects.toThrow(
        "No se puede anular el recibido: los vacíos en planta quedarían en negativo",
      );
    });
  });

  describe("read scope", () => {
    it("no consulta ni expone precios a un operador de planta", async () => {
      prisma.maquilaBalance.findMany.mockResolvedValue([
        {
          customerId: CUSTOMER_ID,
          containerTypeId: CONTAINER_TYPE_ID,
          emptyAtPlant: 4,
          fullToReturn: 2,
          containerType: { id: CONTAINER_TYPE_ID, name: "Con caño" },
        },
      ]);
      prisma.product.findMany.mockResolvedValue([
        {
          id: PRODUCT_ID,
          containerTypeId: CONTAINER_TYPE_ID,
          listPrice: new Prisma.Decimal("3.50"),
        },
      ]);
      prisma.customerPrice.findMany.mockResolvedValue([]);

      const result = await (
        service.listBalances as unknown as (
          customerId: string | undefined,
          actor: { id: string; roles: UserRole[] },
        ) => Promise<Array<Record<string, unknown>>>
      )(CUSTOMER_ID, { id: USER_ID, roles: [UserRole.PLANT_OPERATOR] });

      expect(prisma.product.findMany).not.toHaveBeenCalled();
      expect(prisma.customerPrice.findMany).not.toHaveBeenCalled();
      expect(result[0]).not.toHaveProperty("unitPrice");
      expect(result[0]).not.toHaveProperty("productId");
    });

    it("resuelve precio pactado, precio de lista y servicio faltante para oficina", async () => {
      const otherContainerTypeId = "99999999-9999-4999-8999-999999999999";
      const missingProductContainerTypeId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      prisma.maquilaBalance.findMany.mockResolvedValue([
        {
          customerId: CUSTOMER_ID,
          containerTypeId: CONTAINER_TYPE_ID,
          emptyAtPlant: 4,
          fullToReturn: 2,
          containerType: { id: CONTAINER_TYPE_ID, name: "Con caño" },
        },
        {
          customerId: CUSTOMER_ID,
          containerTypeId: otherContainerTypeId,
          emptyAtPlant: 1,
          fullToReturn: 0,
          containerType: { id: otherContainerTypeId, name: "Sin caño" },
        },
        {
          customerId: CUSTOMER_ID,
          containerTypeId: missingProductContainerTypeId,
          emptyAtPlant: 2,
          fullToReturn: 0,
          containerType: { id: missingProductContainerTypeId, name: "Especial" },
        },
      ]);
      prisma.product.findMany.mockResolvedValue([
        {
          id: PRODUCT_ID,
          containerTypeId: CONTAINER_TYPE_ID,
          listPrice: new Prisma.Decimal("3.50"),
        },
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          containerTypeId: otherContainerTypeId,
          listPrice: new Prisma.Decimal("4.20"),
        },
        {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          containerTypeId: null,
          listPrice: new Prisma.Decimal("9.99"),
        },
      ]);
      prisma.customerPrice.findMany.mockResolvedValue([
        {
          customerId: CUSTOMER_ID,
          productId: PRODUCT_ID,
          price: new Prisma.Decimal("2.75"),
        },
      ]);

      const result = await service.listBalances(CUSTOMER_ID, {
        id: USER_ID,
        roles: [UserRole.SELLER],
      });

      expect(result).toEqual([
        expect.objectContaining({ productId: PRODUCT_ID, unitPrice: "2.75" }),
        expect.objectContaining({
          productId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          unitPrice: "4.20",
        }),
        expect.objectContaining({ productId: null, unitPrice: null }),
      ]);
    });

    it("agrupa saldos físicos para planta sin consultar datos comerciales", async () => {
      prisma.maquilaBalance.findMany.mockResolvedValue([
        {
          customerId: CUSTOMER_ID,
          containerTypeId: CONTAINER_TYPE_ID,
          emptyAtPlant: 4,
          fullToReturn: 2,
          customer: { id: CUSTOMER_ID, name: "Cliente" },
          containerType: { id: CONTAINER_TYPE_ID, name: "Con caño" },
        },
        {
          customerId: CUSTOMER_ID,
          containerTypeId: "99999999-9999-4999-8999-999999999999",
          emptyAtPlant: 1,
          fullToReturn: 3,
          customer: { id: CUSTOMER_ID, name: "Cliente" },
          containerType: {
            id: "99999999-9999-4999-8999-999999999999",
            name: "Sin caño",
          },
        },
      ]);

      const result = await service.listCustomersWithBalances({
        id: USER_ID,
        roles: [UserRole.PLANT_SUPERVISOR],
      });

      expect(result).toEqual([
        expect.objectContaining({
          customerId: CUSTOMER_ID,
          emptyAtPlantTotal: 5,
          fullToReturnTotal: 5,
          balances: [
            expect.not.objectContaining({ unitPrice: expect.anything() }),
            expect.not.objectContaining({ productId: expect.anything() }),
          ],
        }),
      ]);
      expect(prisma.product.findMany).not.toHaveBeenCalled();
    });

    it("agrupa saldos comerciales para oficina", async () => {
      prisma.maquilaBalance.findMany.mockResolvedValue([
        {
          customerId: CUSTOMER_ID,
          containerTypeId: CONTAINER_TYPE_ID,
          emptyAtPlant: 2,
          fullToReturn: 1,
          customer: { id: CUSTOMER_ID, name: "Cliente" },
          containerType: { id: CONTAINER_TYPE_ID, name: "Con caño" },
        },
      ]);
      prisma.product.findMany.mockResolvedValue([
        {
          id: PRODUCT_ID,
          containerTypeId: CONTAINER_TYPE_ID,
          listPrice: new Prisma.Decimal("3.50"),
        },
      ]);
      prisma.customerPrice.findMany.mockResolvedValue([]);

      const result = await service.listCustomersWithBalances({
        id: USER_ID,
        roles: [UserRole.ADMIN],
      });

      expect(result).toEqual([
        {
          customerId: CUSTOMER_ID,
          customerName: "Cliente",
          emptyAtPlantTotal: 2,
          fullToReturnTotal: 1,
          balances: [
            expect.objectContaining({
              productId: PRODUCT_ID,
              unitPrice: "3.50",
            }),
          ],
        },
      ]);
    });

    it("limita al supervisor a llenados y no expone campos comerciales", async () => {
      prisma.maquilaContainerMovement.count.mockResolvedValue(1);
      prisma.maquilaContainerMovement.findMany.mockResolvedValue([
        {
          id: MOVEMENT_ID,
          customerId: CUSTOMER_ID,
          containerTypeId: CONTAINER_TYPE_ID,
          type: MaquilaMovementType.FILLED,
          quantity: 1,
          saleId: null,
          reversesMovementId: null,
          reason: null,
          recordedById: USER_ID,
          occurredAt: new Date(),
          createdAt: new Date(),
          customer: { id: CUSTOMER_ID, name: "Cliente" },
          containerType: { id: CONTAINER_TYPE_ID, name: "Con caño" },
          recordedBy: { id: USER_ID, name: "Operador" },
          sale: null,
        },
      ]);

      const result = await service.listMovements(
        {},
        {
          id: USER_ID,
          roles: [UserRole.PLANT_SUPERVISOR],
        },
      );

      expect(prisma.maquilaContainerMovement.count).toHaveBeenCalledWith({
        where: {
          type: {
            in: [MaquilaMovementType.FILLED, MaquilaMovementType.FILLED_VOID],
          },
        },
      });
      expect(result.data[0]).not.toHaveProperty("saleId");
      expect(result.data[0]).not.toHaveProperty("saleTotal");
    });

    it("filtra al operador por autor y conserva ocultos los datos comerciales", async () => {
      prisma.maquilaContainerMovement.count.mockResolvedValue(0);
      prisma.maquilaContainerMovement.findMany.mockResolvedValue([]);

      await service.listMovements(
        { page: 2, limit: 5 },
        { id: USER_ID, roles: [UserRole.PLANT_OPERATOR] },
      );

      expect(prisma.maquilaContainerMovement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            type: MaquilaMovementType.FILLED,
            recordedById: USER_ID,
          },
          skip: 5,
          take: 5,
        }),
      );
    });

    it("aplica filtros comerciales y expone el total de venta a administración", async () => {
      const occurredAt = new Date("2026-10-12T15:00:00.000Z");
      prisma.maquilaContainerMovement.count.mockResolvedValue(1);
      prisma.maquilaContainerMovement.findMany.mockResolvedValue([
        {
          id: MOVEMENT_ID,
          customerId: CUSTOMER_ID,
          containerTypeId: CONTAINER_TYPE_ID,
          type: MaquilaMovementType.RETURNED,
          quantity: 2,
          saleId: SALE_ID,
          reversesMovementId: null,
          reason: null,
          recordedById: USER_ID,
          occurredAt,
          createdAt: occurredAt,
          customer: { id: CUSTOMER_ID, name: "Cliente" },
          containerType: { id: CONTAINER_TYPE_ID, name: "Con caño" },
          recordedBy: { id: USER_ID, name: "Administrador" },
          sale: { id: SALE_ID, total: new Prisma.Decimal("7.00") },
        },
      ]);

      const result = await service.listMovements(
        {
          customerId: CUSTOMER_ID,
          type: MaquilaMovementType.RETURNED,
          startDate: "2026-10-01",
          endDate: "2026-10-31",
        },
        { id: USER_ID, roles: [UserRole.ADMIN] },
      );

      expect(prisma.maquilaContainerMovement.count).toHaveBeenCalledWith({
        where: {
          customerId: CUSTOMER_ID,
          type: MaquilaMovementType.RETURNED,
          occurredAt: {
            gte: new Date("2026-10-01"),
            lte: new Date("2026-10-31T23:59:59.999Z"),
          },
        },
      });
      expect(result.data[0]).toEqual(
        expect.objectContaining({ saleId: SALE_ID, saleTotal: "7.00" }),
      );
    });
  });

  describe("reconcile", () => {
    it("debe reportar balanceado cuando saldos coinciden con el libro", async () => {
      prisma.maquilaBalance.findMany.mockResolvedValue([
        {
          customerId: CUSTOMER_ID,
          containerTypeId: CONTAINER_TYPE_ID,
          emptyAtPlant: 4,
          fullToReturn: 2,
          customer: { name: "Cliente 1" },
          containerType: { name: "Con caño" },
        },
      ]);

      prisma.maquilaContainerMovement.findMany.mockResolvedValue([
        {
          customerId: CUSTOMER_ID,
          containerTypeId: CONTAINER_TYPE_ID,
          type: MaquilaMovementType.RECEIVED,
          quantity: 10,
          customer: { name: "Cliente 1" },
          containerType: { name: "Con caño" },
        },
        {
          customerId: CUSTOMER_ID,
          containerTypeId: CONTAINER_TYPE_ID,
          type: MaquilaMovementType.FILLED,
          quantity: 6,
          customer: { name: "Cliente 1" },
          containerType: { name: "Con caño" },
        },
        {
          customerId: CUSTOMER_ID,
          containerTypeId: CONTAINER_TYPE_ID,
          type: MaquilaMovementType.RETURNED,
          quantity: 4,
          customer: { name: "Cliente 1" },
          containerType: { name: "Con caño" },
        },
      ]);

      const result = await service.reconcile();
      expect(result.isBalanced).toBe(true);
      expect(result.discrepancies).toHaveLength(0);
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      });
    });

    it("debe detectar descuadre si los saldos materializados difieren del libro", async () => {
      prisma.maquilaBalance.findMany.mockResolvedValue([
        {
          customerId: CUSTOMER_ID,
          containerTypeId: CONTAINER_TYPE_ID,
          emptyAtPlant: 10, // Debería ser 4
          fullToReturn: 2,
          customer: { name: "Cliente 1" },
          containerType: { name: "Con caño" },
        },
      ]);

      prisma.maquilaContainerMovement.findMany.mockResolvedValue([
        {
          customerId: CUSTOMER_ID,
          containerTypeId: CONTAINER_TYPE_ID,
          type: MaquilaMovementType.RECEIVED,
          quantity: 10,
          customer: { name: "Cliente 1" },
          containerType: { name: "Con caño" },
        },
        {
          customerId: CUSTOMER_ID,
          containerTypeId: CONTAINER_TYPE_ID,
          type: MaquilaMovementType.FILLED,
          quantity: 6,
          customer: { name: "Cliente 1" },
          containerType: { name: "Con caño" },
        },
        {
          customerId: CUSTOMER_ID,
          containerTypeId: CONTAINER_TYPE_ID,
          type: MaquilaMovementType.RETURNED,
          quantity: 4,
          customer: { name: "Cliente 1" },
          containerType: { name: "Con caño" },
        },
      ]);

      const result = await service.reconcile();
      expect(result.isBalanced).toBe(false);
      expect(result.discrepancies).toHaveLength(1);
      expect(result.discrepancies[0]!.bookEmpty).toBe(10);
      expect(result.discrepancies[0]!.ledgerEmpty).toBe(4);
    });

    it("debe detectar descuadre si existen movimientos en el libro sin fila en saldos", async () => {
      prisma.maquilaBalance.findMany.mockResolvedValue([]);

      prisma.maquilaContainerMovement.findMany.mockResolvedValue([
        {
          customerId: CUSTOMER_ID,
          containerTypeId: CONTAINER_TYPE_ID,
          type: MaquilaMovementType.RECEIVED,
          quantity: 5,
          customer: { name: "Cliente 1" },
          containerType: { name: "Con caño" },
        },
      ]);

      const result = await service.reconcile();
      expect(result.isBalanced).toBe(false);
      expect(result.discrepancies).toHaveLength(1);
      expect(result.discrepancies[0]!.bookEmpty).toBe(0);
      expect(result.discrepancies[0]!.ledgerEmpty).toBe(5);
    });
  });
});
