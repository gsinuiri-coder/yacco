import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
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
const OTHER_CUSTOMER_ID = "77777777-7777-4777-8777-777777777777";
const IDEMPOTENCY_KEY = "88888888-8888-4888-8888-888888888888";
const VOIDED_PAYMENT_ID = "99999999-9999-4999-8999-999999999999";

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
    voidedAt: null,
    voidedById: null,
    voidReason: null,
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
      create: jest.fn<() => Promise<unknown>>(),
    },
    customer: {
      update: jest.fn<() => Promise<unknown>>(),
      findUnique: jest.fn<() => Promise<unknown>>(),
      findUniqueOrThrow: jest.fn<() => Promise<unknown>>(),
    },
    customerLocation: {
      findUnique: jest.fn<() => Promise<unknown>>(),
    },
    paymentMethod: {
      findUnique: jest.fn<() => Promise<unknown>>(),
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
        where: { id: PAYMENT_ID, status: PaymentStatus.PENDING, voidedAt: null },
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
      prisma.payment.findUnique.mockResolvedValueOnce({
        status: PaymentStatus.CONFIRMED,
        voidedAt: null,
      });

      await expect(service.confirm(PAYMENT_ID, ADMIN_ID)).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.customer.update).toHaveBeenCalledTimes(1);
    });

    it("confirming an already-CONFIRMED payment (e.g. cash from dispatch) is rejected with 409", async () => {
      prisma.payment.updateMany.mockResolvedValue({ count: 0 });
      prisma.payment.findUnique.mockResolvedValue({
        status: PaymentStatus.CONFIRMED,
        voidedAt: null,
      });

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
        where: { id: PAYMENT_ID, status: PaymentStatus.PENDING, voidedAt: null },
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
      prisma.payment.findUnique.mockResolvedValue({
        status: PaymentStatus.REJECTED,
        voidedAt: null,
      });

      await expect(service.reject(PAYMENT_ID, { reason: "otro motivo" }, ADMIN_ID)).rejects.toThrow(
        /ya está en estado REJECTED/,
      );
    });

    it("rejecting an already-CONFIRMED payment is rejected with 409", async () => {
      prisma.payment.updateMany.mockResolvedValue({ count: 0 });
      prisma.payment.findUnique.mockResolvedValue({
        status: PaymentStatus.CONFIRMED,
        voidedAt: null,
      });

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

  describe("createOfficePayment", () => {
    function officeDto(overrides: Record<string, unknown> = {}) {
      return {
        customerId: CUSTOMER_ID,
        paymentMethodId: PAYMENT_METHOD_ID,
        amount: "25.00",
        ...overrides,
      };
    }

    function mockHappyPath(debtBalanceBefore: string) {
      prisma.customer.findUnique.mockResolvedValue({
        id: CUSTOMER_ID,
        active: true,
        debtBalance: decimal(debtBalanceBefore),
      });
      prisma.paymentMethod.findUnique.mockResolvedValue({
        id: PAYMENT_METHOD_ID,
        active: true,
      });
    }

    it("a cash collection reduces debtBalance by exactly the amount and lands CONFIRMED with confirmedById from the actor", async () => {
      mockHappyPath("25.00");
      prisma.payment.create.mockResolvedValue(
        paymentRow({
          status: PaymentStatus.CONFIRMED,
          confirmedById: ADMIN_ID,
          confirmedBy: { id: ADMIN_ID, username: "admin" },
          isOpeningBalance: false,
        }),
      );
      prisma.customer.update.mockResolvedValue({ debtBalance: decimal("0.00") });

      const result = await service.createOfficePayment(officeDto(), ADMIN_ID);

      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: PaymentStatus.CONFIRMED,
            confirmedById: ADMIN_ID,
            recordedById: ADMIN_ID,
            isOpeningBalance: false,
            saleId: null,
            stopId: null,
          }) as unknown,
        }),
      );
      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: CUSTOMER_ID },
        data: { debtBalance: { decrement: decimal("25.00") } },
        select: { debtBalance: true },
      });
      expect(result.response.payment.status).toBe(PaymentStatus.CONFIRMED);
      expect(result.response.debtBalance).toBe("0.00");
      expect(result.response.exceedsDebt).toBe(false);
      expect(result.created).toBe(true);
    });

    // The central decision of this PR: a method whose requiresConfirmation
    // is true (Yape) still lands CONFIRMED when it's an office collection —
    // the counter recording it IS the confirmation. The service never even
    // reads requiresConfirmation off the row.
    it("a Yape collection (requiresConfirmation: true) also lands CONFIRMED, not PENDING", async () => {
      mockHappyPath("25.00");
      prisma.payment.create.mockResolvedValue(
        paymentRow({
          paymentMethod: { id: PAYMENT_METHOD_ID, name: "Yape" },
          status: PaymentStatus.CONFIRMED,
          confirmedById: ADMIN_ID,
        }),
      );
      prisma.customer.update.mockResolvedValue({ debtBalance: decimal("0.00") });

      const result = await service.createOfficePayment(officeDto(), ADMIN_ID);

      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: PaymentStatus.CONFIRMED }) as unknown,
        }),
      );
      expect(result.response.payment.status).toBe(PaymentStatus.CONFIRMED);
    });

    it("overpayment: debt of 40 paid with 50 leaves debtBalance at -10.00 and exceedsDebt true", async () => {
      mockHappyPath("40.00");
      prisma.payment.create.mockResolvedValue(paymentRow({ status: PaymentStatus.CONFIRMED }));
      prisma.customer.update.mockResolvedValue({ debtBalance: decimal("-10.00") });

      const result = await service.createOfficePayment(officeDto({ amount: "50.00" }), ADMIN_ID);

      expect(result.response.debtBalance).toBe("-10.00");
      expect(result.response.exceedsDebt).toBe(true);
    });

    it("an exact payment leaves exceedsDebt false", async () => {
      mockHappyPath("25.00");
      prisma.payment.create.mockResolvedValue(paymentRow({ status: PaymentStatus.CONFIRMED }));
      prisma.customer.update.mockResolvedValue({ debtBalance: decimal("0.00") });

      const result = await service.createOfficePayment(officeDto({ amount: "25.00" }), ADMIN_ID);

      expect(result.response.exceedsDebt).toBe(false);
    });

    it('amount of "0.00" is rejected with 400 and never opens the transaction', async () => {
      await expect(
        service.createOfficePayment(officeDto({ amount: "0.00" }), ADMIN_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("a future paidAt is rejected with 400", async () => {
      const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      await expect(
        service.createOfficePayment(officeDto({ paidAt: future }), ADMIN_ID),
      ).rejects.toThrow(/no puede ser futura/);
    });

    it("an unknown customer is rejected with 404", async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      await expect(service.createOfficePayment(officeDto(), ADMIN_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("an inactive customer is rejected with 400", async () => {
      prisma.customer.findUnique.mockResolvedValue({
        id: CUSTOMER_ID,
        active: false,
        debtBalance: decimal("0.00"),
      });

      await expect(service.createOfficePayment(officeDto(), ADMIN_ID)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.paymentMethod.findUnique).not.toHaveBeenCalled();
    });

    it("a locationId that does not exist at all is rejected with 400", async () => {
      prisma.customer.findUnique.mockResolvedValue({
        id: CUSTOMER_ID,
        active: true,
        debtBalance: decimal("0.00"),
      });
      prisma.customerLocation.findUnique.mockResolvedValue(null);

      await expect(
        service.createOfficePayment(officeDto({ locationId: LOCATION_ID }), ADMIN_ID),
      ).rejects.toThrow(`La ubicación "${LOCATION_ID}" no existe`);
      expect(prisma.paymentMethod.findUnique).not.toHaveBeenCalled();
    });

    it("a locationId belonging to a different customer is rejected with 400, not 404", async () => {
      prisma.customer.findUnique.mockResolvedValue({
        id: CUSTOMER_ID,
        active: true,
        debtBalance: decimal("0.00"),
      });
      prisma.customerLocation.findUnique.mockResolvedValue({ customerId: OTHER_CUSTOMER_ID });

      await expect(
        service.createOfficePayment(officeDto({ locationId: LOCATION_ID }), ADMIN_ID),
      ).rejects.toThrow(/no pertenece a este cliente/);
      expect(prisma.paymentMethod.findUnique).not.toHaveBeenCalled();
    });

    // Blocking on an inactive method is what keeps the synthetic "Apertura"
    // row from ever being usable as a real office collection.
    it("an inactive payment method (e.g. the synthetic Apertura) is rejected with 400", async () => {
      prisma.customer.findUnique.mockResolvedValue({
        id: CUSTOMER_ID,
        active: true,
        debtBalance: decimal("0.00"),
      });
      prisma.paymentMethod.findUnique.mockResolvedValue({ id: PAYMENT_METHOD_ID, active: false });

      await expect(service.createOfficePayment(officeDto(), ADMIN_ID)).rejects.toThrow(
        /no está activo/,
      );
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it("an unknown payment method is rejected with 400", async () => {
      prisma.customer.findUnique.mockResolvedValue({
        id: CUSTOMER_ID,
        active: true,
        debtBalance: decimal("0.00"),
      });
      prisma.paymentMethod.findUnique.mockResolvedValue(null);

      await expect(service.createOfficePayment(officeDto(), ADMIN_ID)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    describe("idempotencyKey", () => {
      it("without a key, behavior is unchanged: never checks for an existing payment", async () => {
        mockHappyPath("25.00");
        prisma.payment.create.mockResolvedValue(paymentRow({ status: PaymentStatus.CONFIRMED }));
        prisma.customer.update.mockResolvedValue({ debtBalance: decimal("0.00") });

        const result = await service.createOfficePayment(officeDto(), ADMIN_ID);

        expect(prisma.payment.findUnique).not.toHaveBeenCalled();
        expect(result.created).toBe(true);
      });

      it("a brand-new key creates the payment, storing the key, and responds created: true", async () => {
        prisma.payment.findUnique.mockResolvedValue(null);
        mockHappyPath("25.00");
        prisma.payment.create.mockResolvedValue(
          paymentRow({ status: PaymentStatus.CONFIRMED, idempotencyKey: IDEMPOTENCY_KEY }),
        );
        prisma.customer.update.mockResolvedValue({ debtBalance: decimal("0.00") });

        const result = await service.createOfficePayment(
          officeDto({ idempotencyKey: IDEMPOTENCY_KEY }),
          ADMIN_ID,
        );

        expect(prisma.payment.findUnique).toHaveBeenCalledWith({
          where: { idempotencyKey: IDEMPOTENCY_KEY },
          include: expect.anything() as unknown,
        });
        expect(prisma.payment.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ idempotencyKey: IDEMPOTENCY_KEY }) as unknown,
          }),
        );
        expect(result.created).toBe(true);
        expect(result.response.payment.id).toBe(PAYMENT_ID);
      });

      it("a repeated key returns the EXISTING row (created: false), never creates a second one", async () => {
        prisma.payment.findUnique.mockResolvedValue(
          paymentRow({
            status: PaymentStatus.CONFIRMED,
            idempotencyKey: IDEMPOTENCY_KEY,
            amount: decimal("25.00"),
          }),
        );
        prisma.customer.findUniqueOrThrow.mockResolvedValue({ debtBalance: decimal("0.00") });

        const result = await service.createOfficePayment(
          officeDto({ idempotencyKey: IDEMPOTENCY_KEY }),
          ADMIN_ID,
        );

        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(prisma.payment.create).not.toHaveBeenCalled();
        expect(result.created).toBe(false);
        expect(result.response.payment.id).toBe(PAYMENT_ID);
      });

      // The point of re-reading rather than reconstructing: whatever changed
      // on the row between the first call and the retry is what the caller
      // sees — never the CONFIRMED snapshot the first call would have made.
      it("a replay reflects the CURRENT state of the row, not the state at the original write", async () => {
        prisma.payment.findUnique.mockResolvedValue(
          paymentRow({
            status: PaymentStatus.REJECTED,
            idempotencyKey: IDEMPOTENCY_KEY,
            amount: decimal("25.00"),
            rejectedById: ADMIN_ID,
            rejectedBy: { id: ADMIN_ID, username: "admin" },
            rejectionReason: "Duplicado detectado a mano",
          }),
        );
        prisma.customer.findUniqueOrThrow.mockResolvedValue({ debtBalance: decimal("25.00") });

        const result = await service.createOfficePayment(
          officeDto({ idempotencyKey: IDEMPOTENCY_KEY }),
          ADMIN_ID,
        );

        expect(result.response.payment.status).toBe(PaymentStatus.REJECTED);
        expect(result.response.payment.rejectionReason).toBe("Duplicado detectado a mano");
        expect(result.created).toBe(false);
      });

      it("the same key with a different customerId is rejected with 409, without touching the existing row", async () => {
        prisma.payment.findUnique.mockResolvedValue(
          paymentRow({
            customerId: CUSTOMER_ID,
            idempotencyKey: IDEMPOTENCY_KEY,
            amount: decimal("25.00"),
          }),
        );

        await expect(
          service.createOfficePayment(
            officeDto({ idempotencyKey: IDEMPOTENCY_KEY, customerId: OTHER_CUSTOMER_ID }),
            ADMIN_ID,
          ),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      it("the same key with a different amount is rejected with 409", async () => {
        prisma.payment.findUnique.mockResolvedValue(
          paymentRow({
            customerId: CUSTOMER_ID,
            idempotencyKey: IDEMPOTENCY_KEY,
            amount: decimal("25.00"),
          }),
        );

        await expect(
          service.createOfficePayment(
            officeDto({ idempotencyKey: IDEMPOTENCY_KEY, amount: "99.00" }),
            ADMIN_ID,
          ),
        ).rejects.toBeInstanceOf(ConflictException);
      });

      // The pre-check (findUnique) is the common-case fast path; the unique
      // index is the actual guarantee under a race. Two concurrent requests
      // with the SAME brand-new key both pass the pre-check as "not found",
      // and only one insert can win — the loser must recover, not 500.
      it("a P2002 race on the unique key falls back to reading the winner's row, not an error", async () => {
        prisma.payment.findUnique.mockResolvedValueOnce(null);
        mockHappyPath("25.00");
        prisma.$transaction.mockImplementationOnce(() =>
          Promise.reject(Object.assign(new Error("Unique constraint failed"), { code: "P2002" })),
        );
        prisma.payment.findUniqueOrThrow.mockResolvedValue(
          paymentRow({
            status: PaymentStatus.CONFIRMED,
            idempotencyKey: IDEMPOTENCY_KEY,
            amount: decimal("25.00"),
          }),
        );
        prisma.customer.findUniqueOrThrow.mockResolvedValue({ debtBalance: decimal("0.00") });

        const result = await service.createOfficePayment(
          officeDto({ idempotencyKey: IDEMPOTENCY_KEY }),
          ADMIN_ID,
        );

        expect(result.created).toBe(false);
        expect(result.response.payment.id).toBe(PAYMENT_ID);
      });

      it("a non-P2002 error from the transaction is rethrown as-is, not swallowed as a replay", async () => {
        prisma.payment.findUnique.mockResolvedValueOnce(null);
        mockHappyPath("25.00");
        prisma.$transaction.mockImplementationOnce(() => Promise.reject(new Error("boom")));

        await expect(
          service.createOfficePayment(officeDto({ idempotencyKey: IDEMPOTENCY_KEY }), ADMIN_ID),
        ).rejects.toThrow("boom");
      });
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
        isOpeningBalance: false,
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

    /**
     * Un cobro anulado SIGUE en la bandeja, con su monto original y su motivo
     * a la vista, y sigue sumando en `totals`. Esconder un cobro que el
     * cliente sabe que hizo es peor que mostrarlo tachado: quien lo busca no
     * lo encontraría y lo registraría de nuevo. Mismo idioma que el estado de
     * cuenta, donde una fila anulada aparece con su monto y efecto cero.
     */
    it("un cobro anulado sigue apareciendo, con su anulación a la vista", async () => {
      const voidedAt = new Date("2026-08-26T14:00:00.000Z");
      prisma.payment.count.mockResolvedValue(2);
      prisma.payment.findMany.mockResolvedValue([
        paymentRow(),
        paymentRow({
          id: VOIDED_PAYMENT_ID,
          status: PaymentStatus.CONFIRMED,
          voidedAt,
          voidedById: RECORDED_BY_ID,
          voidReason: "La parada se corrigió: no había pagado",
        }),
      ]);
      prisma.payment.aggregate.mockResolvedValue({
        _count: { _all: 2 },
        _sum: { amount: decimal("50.00") },
      });

      const result = await service.findAll({ page: 1, limit: 20 });

      const voided = result.data.find((row) => row.id === VOIDED_PAYMENT_ID);
      expect(voided?.voidedAt).toEqual(voidedAt);
      expect(voided?.voidReason).toBe("La parada se corrigió: no había pagado");
      expect(voided?.amount).toBe("25.00");
      // El `where` de la página no filtra lo anulado, y el total tampoco: el
      // total describe la lista, y tiene que cuadrar con lo que el ojo suma.
      expect(prisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isOpeningBalance: false } }),
      );
      expect(result.totals).toEqual({ count: 2, amount: "50.00" });
    });

    it("un cobro en pie viaja con voidedAt y voidReason en null", async () => {
      prisma.payment.count.mockResolvedValue(1);
      prisma.payment.findMany.mockResolvedValue([paymentRow()]);
      prisma.payment.aggregate.mockResolvedValue({
        _count: { _all: 1 },
        _sum: { amount: decimal("25.00") },
      });

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result.data[0]?.voidedAt).toBeNull();
      expect(result.data[0]?.voidReason).toBeNull();
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
        where: {
          isOpeningBalance: false,
          paidAt: { gte: new Date("2026-08-01T00:00:00.000Z") },
        },
      });
    });

    it("filters by paidTo alone", async () => {
      prisma.payment.count.mockResolvedValue(0);
      prisma.payment.findMany.mockResolvedValue([]);
      prisma.payment.aggregate.mockResolvedValue({ _count: { _all: 0 }, _sum: { amount: null } });

      await service.findAll({ page: 1, limit: 20, paidTo: "2026-08-31T23:59:59.999Z" });

      expect(prisma.payment.count).toHaveBeenCalledWith({
        where: {
          isOpeningBalance: false,
          paidAt: { lte: new Date("2026-08-31T23:59:59.999Z") },
        },
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

    it("by default excludes isOpeningBalance rows from both the page and totals", async () => {
      prisma.payment.count.mockResolvedValue(0);
      prisma.payment.findMany.mockResolvedValue([]);
      prisma.payment.aggregate.mockResolvedValue({ _count: { _all: 0 }, _sum: { amount: null } });

      await service.findAll({ page: 1, limit: 20 });

      expect(prisma.payment.count).toHaveBeenCalledWith({ where: { isOpeningBalance: false } });
      expect(prisma.payment.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isOpeningBalance: false } }),
      );
    });

    it("includeOpeningBalance=true drops the isOpeningBalance filter from both the page and totals", async () => {
      prisma.payment.count.mockResolvedValue(0);
      prisma.payment.findMany.mockResolvedValue([]);
      prisma.payment.aggregate.mockResolvedValue({ _count: { _all: 0 }, _sum: { amount: null } });

      await service.findAll({ page: 1, limit: 20, includeOpeningBalance: true });

      expect(prisma.payment.count).toHaveBeenCalledWith({ where: {} });
      expect(prisma.payment.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
    });
  });
});
