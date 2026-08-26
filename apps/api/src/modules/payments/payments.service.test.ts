import { ConflictException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PaymentStatus, Prisma } from "@prisma/client";
import { jest } from "@jest/globals";
import { PrismaService } from "../../prisma/prisma.service.js";
import { PaymentsService } from "./payments.service.js";

const PAYMENT_ID = "11111111-1111-4111-8111-111111111111";
const CUSTOMER_ID = "22222222-2222-4222-8222-222222222222";
const LOCATION_ID = "33333333-3333-4333-8333-333333333333";
const PAYMENT_METHOD_ID = "44444444-4444-4444-8444-444444444444";
const RECORDED_BY_ID = "55555555-5555-4555-8555-555555555555";
const ADMIN_ID = "66666666-6666-4666-8666-666666666666";
const MISSING_ID = "00000000-0000-4000-8000-000000000000";

function decimal(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function paymentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PAYMENT_ID,
    customerId: CUSTOMER_ID,
    customer: { id: CUSTOMER_ID, name: "Bodega Santa Rosa" },
    locationId: LOCATION_ID,
    location: { id: LOCATION_ID, name: "Principal" },
    saleId: null,
    stopId: null,
    paymentMethodId: PAYMENT_METHOD_ID,
    paymentMethod: { id: PAYMENT_METHOD_ID, name: "Yape" },
    paidAt: new Date("2026-08-20T15:00:00.000Z"),
    amount: decimal("25.00"),
    status: PaymentStatus.PENDING,
    confirmedAt: null,
    confirmedById: null,
    confirmedBy: null,
    rejectedAt: null,
    rejectedById: null,
    rejectedBy: null,
    rejectionReason: null,
    isOpeningBalance: false,
    recordedById: RECORDED_BY_ID,
    recordedBy: { id: RECORDED_BY_ID, username: "repartidor" },
    ...overrides,
  };
}

function buildPrismaMock() {
  return {
    payment: {
      count: jest.fn<() => Promise<unknown>>(),
      findMany: jest.fn<() => Promise<unknown>>(),
      aggregate: jest.fn<() => Promise<unknown>>(),
      updateMany: jest.fn<() => Promise<unknown>>(),
      findUnique: jest.fn<() => Promise<unknown>>(),
      findUniqueOrThrow: jest.fn<() => Promise<unknown>>(),
    },
    customer: {
      update: jest.fn<() => Promise<unknown>>(),
      findUniqueOrThrow: jest.fn<() => Promise<unknown>>(),
    },
    $transaction: jest.fn<(arg: unknown) => Promise<unknown>>(),
  };
}

describe("PaymentsService", () => {
  let service: PaymentsService;
  let prisma: ReturnType<typeof buildPrismaMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock();
    // findAll() passes an array (a batch of independent queries);
    // confirm()/reject() pass a callback (an interactive transaction).
    prisma.$transaction.mockImplementation((arg) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => Promise<unknown>)(prisma),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [PaymentsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(PaymentsService);
  });

  describe("confirm", () => {
    it("confirming a PENDING payment reduces debtBalance by exactly the amount and stamps confirmedAt/confirmedById", async () => {
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });
      prisma.payment.findUniqueOrThrow.mockResolvedValue(
        paymentRow({
          status: PaymentStatus.CONFIRMED,
          confirmedAt: new Date("2026-08-25T10:00:00.000Z"),
          confirmedById: ADMIN_ID,
          confirmedBy: { id: ADMIN_ID, username: "admin" },
        }),
      );
      prisma.customer.update.mockResolvedValue({ debtBalance: decimal("15.00") });

      const result = await service.confirm(PAYMENT_ID, ADMIN_ID);

      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { id: PAYMENT_ID, status: PaymentStatus.PENDING },
        data: expect.objectContaining({
          status: PaymentStatus.CONFIRMED,
          confirmedById: ADMIN_ID,
        }) as unknown,
      });
      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: CUSTOMER_ID },
        data: { debtBalance: { decrement: decimal("25.00") } },
        select: { debtBalance: true },
      });
      expect(result.payment.status).toBe(PaymentStatus.CONFIRMED);
      expect(result.payment.confirmedBy?.username).toBe("admin");
      expect(result.debtBalance).toBe("15.00");
    });

    // Written first, per the task's own instruction: this is the point of the PR.
    it("confirming twice: the second call gets 409, and debtBalance is decremented only once", async () => {
      // First call: the guarded UPDATE affects the row.
      prisma.payment.updateMany.mockResolvedValueOnce({ count: 1 });
      prisma.payment.findUniqueOrThrow.mockResolvedValueOnce(
        paymentRow({ status: PaymentStatus.CONFIRMED }),
      );
      prisma.customer.update.mockResolvedValueOnce({ debtBalance: decimal("15.00") });
      await service.confirm(PAYMENT_ID, ADMIN_ID);
      expect(prisma.customer.update).toHaveBeenCalledTimes(1);

      // Second call: the same guarded UPDATE now affects nothing (status is
      // already CONFIRMED), so it must abort before touching debtBalance again.
      prisma.payment.updateMany.mockResolvedValueOnce({ count: 0 });
      prisma.payment.findUnique.mockResolvedValueOnce({ status: PaymentStatus.CONFIRMED });

      await expect(service.confirm(PAYMENT_ID, ADMIN_ID)).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.customer.update).toHaveBeenCalledTimes(1);
    });

    it("confirming an already-CONFIRMED payment (e.g. cash from dispatch) is rejected with 409", async () => {
      prisma.payment.updateMany.mockResolvedValue({ count: 0 });
      prisma.payment.findUnique.mockResolvedValue({ status: PaymentStatus.CONFIRMED });

      await expect(service.confirm(PAYMENT_ID, ADMIN_ID)).rejects.toThrow(
        /ya está en estado CONFIRMED/,
      );
      expect(prisma.customer.update).not.toHaveBeenCalled();
    });

    it("confirming an unknown id is rejected with 404", async () => {
      prisma.payment.updateMany.mockResolvedValue({ count: 0 });
      prisma.payment.findUnique.mockResolvedValue(null);

      await expect(service.confirm(MISSING_ID, ADMIN_ID)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("reject", () => {
    it("rejecting a PENDING payment leaves debtBalance untouched and records the reason", async () => {
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });
      prisma.payment.findUniqueOrThrow.mockResolvedValue(
        paymentRow({
          status: PaymentStatus.REJECTED,
          rejectedAt: new Date("2026-08-25T10:00:00.000Z"),
          rejectedById: ADMIN_ID,
          rejectedBy: { id: ADMIN_ID, username: "admin" },
          rejectionReason: "El Yape nunca llegó a la cuenta",
        }),
      );
      prisma.customer.findUniqueOrThrow.mockResolvedValue({ debtBalance: decimal("40.00") });

      const result = await service.reject(
        PAYMENT_ID,
        { reason: "El Yape nunca llegó a la cuenta" },
        ADMIN_ID,
      );

      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { id: PAYMENT_ID, status: PaymentStatus.PENDING },
        data: {
          status: PaymentStatus.REJECTED,
          rejectedAt: expect.any(Date) as Date,
          rejectedById: ADMIN_ID,
          rejectionReason: "El Yape nunca llegó a la cuenta",
        },
      });
      expect(prisma.customer.update).not.toHaveBeenCalled();
      expect(result.payment.status).toBe(PaymentStatus.REJECTED);
      expect(result.payment.rejectionReason).toBe("El Yape nunca llegó a la cuenta");
      expect(result.debtBalance).toBe("40.00");
    });

    it("rejecting an already-REJECTED payment is rejected with 409", async () => {
      prisma.payment.updateMany.mockResolvedValue({ count: 0 });
      prisma.payment.findUnique.mockResolvedValue({ status: PaymentStatus.REJECTED });

      await expect(service.reject(PAYMENT_ID, { reason: "otro motivo" }, ADMIN_ID)).rejects.toThrow(
        /ya está en estado REJECTED/,
      );
    });

    it("rejecting an already-CONFIRMED payment is rejected with 409", async () => {
      prisma.payment.updateMany.mockResolvedValue({ count: 0 });
      prisma.payment.findUnique.mockResolvedValue({ status: PaymentStatus.CONFIRMED });

      await expect(
        service.reject(PAYMENT_ID, { reason: "otro motivo" }, ADMIN_ID),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("rejecting an unknown id is rejected with 404", async () => {
      prisma.payment.updateMany.mockResolvedValue({ count: 0 });
      prisma.payment.findUnique.mockResolvedValue(null);

      await expect(
        service.reject(MISSING_ID, { reason: "motivo" }, ADMIN_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("findAll", () => {
    it("filters by status/paymentMethodId/customerId/paidFrom/paidTo, and totals reflects the SAME where as the page", async () => {
      prisma.payment.count.mockResolvedValue(3);
      prisma.payment.findMany.mockResolvedValue([paymentRow()]);
      prisma.payment.aggregate.mockResolvedValue({
        _count: { _all: 3 },
        _sum: { amount: decimal("75.00") },
      });

      const result = await service.findAll({
        page: 1,
        limit: 20,
        status: PaymentStatus.PENDING,
        paymentMethodId: PAYMENT_METHOD_ID,
        customerId: CUSTOMER_ID,
        paidFrom: "2026-08-01T00:00:00.000Z",
        paidTo: "2026-08-31T23:59:59.999Z",
      });

      const expectedWhere = {
        status: PaymentStatus.PENDING,
        paymentMethodId: PAYMENT_METHOD_ID,
        customerId: CUSTOMER_ID,
        paidAt: {
          gte: new Date("2026-08-01T00:00:00.000Z"),
          lte: new Date("2026-08-31T23:59:59.999Z"),
        },
      };
      expect(prisma.payment.count).toHaveBeenCalledWith({ where: expectedWhere });
      expect(prisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expectedWhere, orderBy: { paidAt: "asc" } }),
      );
      expect(prisma.payment.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({ where: expectedWhere }),
      );
      expect(result.totals).toEqual({ count: 3, amount: "75.00" });
      expect(result.total).toBe(3);
    });

    it("an empty filtered set returns totals of count 0 and amount 0.00, not an error", async () => {
      prisma.payment.count.mockResolvedValue(0);
      prisma.payment.findMany.mockResolvedValue([]);
      prisma.payment.aggregate.mockResolvedValue({ _count: { _all: 0 }, _sum: { amount: null } });

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result.totals).toEqual({ count: 0, amount: "0.00" });
      expect(result.data).toEqual([]);
    });

    it("filters by paidFrom alone", async () => {
      prisma.payment.count.mockResolvedValue(0);
      prisma.payment.findMany.mockResolvedValue([]);
      prisma.payment.aggregate.mockResolvedValue({ _count: { _all: 0 }, _sum: { amount: null } });

      await service.findAll({ page: 1, limit: 20, paidFrom: "2026-08-01T00:00:00.000Z" });

      expect(prisma.payment.count).toHaveBeenCalledWith({
        where: { paidAt: { gte: new Date("2026-08-01T00:00:00.000Z") } },
      });
    });

    it("filters by paidTo alone", async () => {
      prisma.payment.count.mockResolvedValue(0);
      prisma.payment.findMany.mockResolvedValue([]);
      prisma.payment.aggregate.mockResolvedValue({ _count: { _all: 0 }, _sum: { amount: null } });

      await service.findAll({ page: 1, limit: 20, paidTo: "2026-08-31T23:59:59.999Z" });

      expect(prisma.payment.count).toHaveBeenCalledWith({
        where: { paidAt: { lte: new Date("2026-08-31T23:59:59.999Z") } },
      });
    });

    it("rejects paidFrom after paidTo", async () => {
      await expect(
        service.findAll({
          page: 1,
          limit: 20,
          paidFrom: "2026-08-31T00:00:00.000Z",
          paidTo: "2026-08-01T00:00:00.000Z",
        }),
      ).rejects.toThrow(/no puede ser posterior/);
    });
  });
});
