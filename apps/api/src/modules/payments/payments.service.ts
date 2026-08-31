import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PaymentStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service.js";
import type {
  CreateOfficePaymentResponseDto,
  PaginatedPaymentsDto,
  PaymentActionResponseDto,
  PaymentRowDto,
} from "./dto/payment-response.dto.js";
import type { CreateOfficePaymentDto } from "./dto/create-office-payment.dto.js";
import type { ListPaymentsQueryDto } from "./dto/list-payments-query.dto.js";
import type { RejectPaymentDto } from "./dto/reject-payment.dto.js";

/** Everything the wire shape needs, and nothing else. */
const PAYMENT_INCLUDE = {
  customer: { select: { id: true, name: true } },
  location: { select: { id: true, name: true } },
  paymentMethod: { select: { id: true, name: true } },
  recordedBy: { select: { id: true, username: true } },
  confirmedBy: { select: { id: true, username: true } },
  rejectedBy: { select: { id: true, username: true } },
} satisfies Prisma.PaymentInclude;

type PaymentWithRelations = Prisma.PaymentGetPayload<{ include: typeof PAYMENT_INCLUDE }>;

function toPaymentRow(payment: PaymentWithRelations): PaymentRowDto {
  return {
    id: payment.id,
    customer: payment.customer,
    location: payment.location,
    paymentMethod: payment.paymentMethod,
    amount: payment.amount.toFixed(2),
    status: payment.status,
    paidAt: payment.paidAt,
    saleId: payment.saleId,
    stopId: payment.stopId,
    recordedBy: payment.recordedBy,
    confirmedAt: payment.confirmedAt,
    confirmedBy: payment.confirmedBy,
    rejectedAt: payment.rejectedAt,
    rejectedBy: payment.rejectedBy,
    rejectionReason: payment.rejectionReason,
    isOpeningBalance: payment.isOpeningBalance,
  };
}

function buildPaymentFilter(query: ListPaymentsQueryDto): Prisma.PaymentWhereInput {
  const { status, paymentMethodId, customerId, paidFrom, paidTo, includeOpeningBalance } = query;
  const from = paidFrom === undefined ? undefined : new Date(paidFrom);
  const to = paidTo === undefined ? undefined : new Date(paidTo);

  if (from !== undefined && to !== undefined && from > to) {
    throw new BadRequestException("La fecha desde no puede ser posterior a la fecha hasta");
  }

  return {
    ...(status !== undefined ? { status } : {}),
    ...(paymentMethodId !== undefined ? { paymentMethodId } : {}),
    ...(customerId !== undefined ? { customerId } : {}),
    // Default excludes opening credits: real debt, but money that moved
    // before the system existed — see includeOpeningBalance's own doc.
    ...(includeOpeningBalance === true ? {} : { isOpeningBalance: false }),
    ...(from !== undefined || to !== undefined
      ? {
          paidAt: {
            ...(from !== undefined ? { gte: from } : {}),
            ...(to !== undefined ? { lte: to } : {}),
          },
        }
      : {}),
  };
}

/**
 * Same reasoning as SalesService.assertPositiveAmount: the DTO's
 * `@Matches(MONEY_PATTERN)` already rejects a comma decimal, three decimals,
 * a negative sign or a JSON number before this runs, through the
 * ValidationPipe — this only adds the one thing a regex can't express, that
 * "0.00" is syntactically money but never a valid collection.
 */
function assertPositiveAmount(amount: string): Prisma.Decimal {
  const parsed = new Prisma.Decimal(amount);
  if (parsed.lte(0)) {
    throw new BadRequestException("El monto debe ser mayor que 0");
  }
  return parsed;
}

function assertPaymentNotFuture(paidAt: Date): void {
  if (paidAt.getTime() > Date.now()) {
    throw new BadRequestException("La fecha del pago no puede ser futura");
  }
}

function isPrismaKnownError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

/**
 * `exceedsDebt` means exactly one thing: the customer's debtBalance AFTER
 * this payment is negative (a favor/advance, not a coincidence of how the
 * payment was computed). It is NOT "amount paid was more than debt owed
 * before this payment" — that reads as the same thing but is a different
 * quantity once a payment can be reported twice (create, then an
 * idempotencyKey replay): the create path knows the pre-payment balance
 * from the read it already did; a replay only has the CURRENT (already
 * post-payment) balance to work with, and re-deriving "what it must have
 * been before" would mean trusting the request's amount over the database.
 * `amount > previousBalance` and `previousBalance - amount < 0` (i.e.
 * `resultingBalance < 0`) are the same inequality — subtracting `amount`
 * from both sides of a `>` doesn't flip it — so computing it this way,
 * against the balance this response already reports, gives create and
 * replay identical results without either branch needing the other's data.
 */
function exceedsDebt(resultingDebtBalance: Prisma.Decimal): boolean {
  return resultingDebtBalance.lt(0);
}

/** What POST /payments returns, plus whether it actually wrote a new row. */
export interface CreateOfficePaymentResult {
  response: CreateOfficePaymentResponseDto;
  /** false when an idempotencyKey replay found the payment already made. */
  created: boolean;
}

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * HU-18: a collection made at the plant or by transfer, outside a route —
   * the counter recording it IS the authority confirming the money landed,
   * unlike a driver's dispatch collection (registerStopDeliveryWithinTransaction),
   * where a method with requiresConfirmation lands PENDING because nobody
   * has yet seen the money arrive. Here the person typing this in IS looking
   * at the phone/account where it just landed; asking them to "confirm"
   * afterward what they just witnessed would be an empty extra step. So this
   * always lands CONFIRMED, regardless of the payment method's
   * requiresConfirmation — that column keeps governing the route path only.
   *
   * Overpayment is allowed on purpose: debtBalance can go negative (a real
   * advance/favor balance, same concept as SalesService's opening credit),
   * and blocking it would fight the one thing that lets the screen show
   * "queda a favor S/10" instead of a raw validation error.
   *
   * `idempotencyKey` (optional): a network retry of this exact POST must
   * never charge the same collection twice. Without a key, behavior is
   * unchanged — every call creates a row. With one: a first call creates and
   * returns `created: true`; a retry with the SAME key returns the payment
   * as it stands in the database RIGHT NOW (never rebuilt from this
   * request's body) with `created: false` — so if something else touched it
   * between the two calls, the retry sees that, not a stale snapshot. The
   * key is checked with a plain read first (the common case, one query), but
   * the actual guarantee against a concurrent duplicate is the column's
   * unique index: two requests racing on a brand-new key both pass that read
   * and both attempt the insert, and only one of them can win it — the loser
   * catches the resulting P2002 and re-reads instead of erroring.
   */
  async createOfficePayment(
    dto: CreateOfficePaymentDto,
    actorId: string,
  ): Promise<CreateOfficePaymentResult> {
    const amount = assertPositiveAmount(dto.amount);
    const now = new Date();
    const paidAt = dto.paidAt !== undefined ? new Date(dto.paidAt) : now;
    assertPaymentNotFuture(paidAt);

    if (dto.idempotencyKey !== undefined) {
      const existing = await this.prisma.payment.findUnique({
        where: { idempotencyKey: dto.idempotencyKey },
        include: PAYMENT_INCLUDE,
      });
      if (existing !== null) {
        return this.buildReplayResult(existing, dto, amount);
      }
    }

    try {
      const response = await this.prisma.$transaction(async (tx) => {
        const customer = await tx.customer.findUnique({
          where: { id: dto.customerId },
          select: { id: true, active: true, debtBalance: true },
        });
        if (customer === null) {
          throw new NotFoundException(`El cliente "${dto.customerId}" no existe`);
        }
        if (!customer.active) {
          throw new BadRequestException(`El cliente "${dto.customerId}" no está activo`);
        }

        if (dto.locationId !== undefined) {
          const location = await tx.customerLocation.findUnique({
            where: { id: dto.locationId },
            select: { customerId: true },
          });
          if (location === null) {
            throw new BadRequestException(`La ubicación "${dto.locationId}" no existe`);
          }
          if (location.customerId !== dto.customerId) {
            throw new BadRequestException(
              `La ubicación "${dto.locationId}" no pertenece a este cliente`,
            );
          }
        }

        const paymentMethod = await tx.paymentMethod.findUnique({
          where: { id: dto.paymentMethodId },
          select: { id: true, active: true },
        });
        if (paymentMethod === null) {
          throw new BadRequestException(`El método de pago "${dto.paymentMethodId}" no existe`);
        }
        // Office collection blocks on an inactive method — unlike dispatch,
        // which has no such gate. This is the only thing that keeps the
        // synthetic "Apertura" method from being usable as a real collection.
        if (!paymentMethod.active) {
          throw new BadRequestException(
            `El método de pago "${dto.paymentMethodId}" no está activo`,
          );
        }

        const payment = await tx.payment.create({
          data: {
            customerId: dto.customerId,
            locationId: dto.locationId ?? null,
            saleId: null,
            stopId: null,
            paymentMethodId: dto.paymentMethodId,
            paidAt,
            amount,
            status: PaymentStatus.CONFIRMED,
            confirmedAt: now,
            confirmedById: actorId,
            isOpeningBalance: false,
            recordedById: actorId,
            idempotencyKey: dto.idempotencyKey ?? null,
          },
          include: PAYMENT_INCLUDE,
        });

        const updatedCustomer = await tx.customer.update({
          where: { id: dto.customerId },
          data: { debtBalance: { decrement: amount } },
          select: { debtBalance: true },
        });

        return {
          payment: toPaymentRow(payment),
          debtBalance: updatedCustomer.debtBalance.toFixed(2),
          exceedsDebt: exceedsDebt(updatedCustomer.debtBalance),
        };
      });

      return { response, created: true };
    } catch (error) {
      // payments_idempotency_key_key: lost a create race against a
      // concurrent request carrying the same brand-new key. The winner's row
      // is now there to read — same outcome as finding it existed already.
      if (dto.idempotencyKey !== undefined && isPrismaKnownError(error, "P2002")) {
        const existing = await this.prisma.payment.findUniqueOrThrow({
          where: { idempotencyKey: dto.idempotencyKey },
          include: PAYMENT_INCLUDE,
        });
        return this.buildReplayResult(existing, dto, amount);
      }
      throw error;
    }
  }

  /**
   * `existing` is trusted as-is — read fresh, never merged with `dto` — so
   * the caller sees whatever is true right now, even if it diverges from
   * what the original request produced. Only customerId/amount gate the
   * replay: a key reused for a different customer or a different amount is
   * the caller's bug, not a legitimate retry, so it 409s instead of quietly
   * returning someone else's payment.
   */
  private async buildReplayResult(
    existing: PaymentWithRelations,
    dto: CreateOfficePaymentDto,
    amount: Prisma.Decimal,
  ): Promise<CreateOfficePaymentResult> {
    if (existing.customerId !== dto.customerId || !existing.amount.equals(amount)) {
      throw new ConflictException(
        `La clave de idempotencia "${dto.idempotencyKey}" ya se usó para un pago con otro ` +
          "cliente o un monto distinto. Generá una clave nueva para este cobro.",
      );
    }

    const customer = await this.prisma.customer.findUniqueOrThrow({
      where: { id: existing.customerId },
      select: { debtBalance: true },
    });

    return {
      response: {
        payment: toPaymentRow(existing),
        debtBalance: customer.debtBalance.toFixed(2),
        exceedsDebt: exceedsDebt(customer.debtBalance),
      },
      created: false,
    };
  }

  /**
   * The office's confirmation tray: every payment, oldest paidAt first — the
   * longest-unconfirmed one is the riskiest, so it leads. `totals` is
   * computed with the SAME `where` as the page, via a separate `aggregate`,
   * not derived from `data`: the office needs "how much Yape is sitting
   * unconfirmed today" across the whole filtered set, not just the 20 rows
   * on screen.
   *
   * `voidedAt` NO se filtra acá, a diferencia de las cuatro sumas de
   * `RouteSettlementService.computeExpected`, y la diferencia es deliberada:
   * ese total describe LA LISTA, no un saldo. Tiene que sumar exactamente las
   * filas que se muestran —por eso comparte el `where` con la página— y ya
   * incluye los REJECTED por la misma razón. Filtrar lo anulado acá dejaría
   * un total que no cuadra con lo que el ojo suma en pantalla. Si un cobro
   * anulado debe desaparecer de la bandeja, eso se decide en el filtro de la
   * pantalla, no en el total.
   */
  async findAll(query: ListPaymentsQueryDto): Promise<PaginatedPaymentsDto> {
    const { page, limit } = query;
    const where = buildPaymentFilter(query);

    const [total, payments, totals] = await this.prisma.$transaction([
      this.prisma.payment.count({ where }),
      this.prisma.payment.findMany({
        where,
        include: PAYMENT_INCLUDE,
        orderBy: { paidAt: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.payment.aggregate({ where, _count: { _all: true }, _sum: { amount: true } }),
    ]);

    return {
      data: payments.map(toPaymentRow),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      totals: {
        count: totals._count._all,
        amount: (totals._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
      },
    };
  }

  /**
   * PENDING -> CONFIRMED, and nothing else — never re-confirms an already
   * CONFIRMED or REJECTED row. The status guard lives in the WHERE clause of
   * the UPDATE itself, never a prior read-then-write: two simultaneous
   * clicks on the same payment must have exactly one of them reduce
   * `debtBalance`, not both. `debtBalance` moves by exactly `amount` in the
   * SAME transaction as the status flip — the whole point of this PR.
   *
   * `voidedAt: null` va en esa misma guarda: un cobro anulado sigue PENDING
   * —anular no cambia el estado— y la bandeja de confirmación lo lista igual
   * que a uno vivo, así que sin esta cláusula la oficina podría confirmarlo y
   * bajar la deuda por un cobro cuya venta ya se revirtió entera. Sería un
   * crédito fantasma, y encima haría diverger `debtBalance` del saldo que el
   * estado de cuenta reconstruye, que es justo lo que la anulación arregló.
   */
  async confirm(id: string, actorId: string): Promise<PaymentActionResponseDto> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.payment.updateMany({
        where: { id, status: PaymentStatus.PENDING, voidedAt: null },
        data: { status: PaymentStatus.CONFIRMED, confirmedAt: new Date(), confirmedById: actorId },
      });
      if (count === 0) {
        await this.throwNotPendingConflict(tx, id);
      }

      const payment = await tx.payment.findUniqueOrThrow({
        where: { id },
        include: PAYMENT_INCLUDE,
      });
      const customer = await tx.customer.update({
        where: { id: payment.customerId },
        data: { debtBalance: { decrement: payment.amount } },
        select: { debtBalance: true },
      });

      return { payment: toPaymentRow(payment), debtBalance: customer.debtBalance.toFixed(2) };
    });
  }

  /**
   * PENDING -> REJECTED. Same idempotent guard as confirm(), `voidedAt: null`
   * included, but this one touches no balance at all: a PENDING payment never
   * reduced debtBalance, so there is nothing here to put back. Rechazar un
   * cobro anulado no movería plata, pero escribiría sobre él un motivo de
   * rechazo que contradice el de la anulación, y son hechos distintos.
   */
  async reject(
    id: string,
    dto: RejectPaymentDto,
    actorId: string,
  ): Promise<PaymentActionResponseDto> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.payment.updateMany({
        where: { id, status: PaymentStatus.PENDING, voidedAt: null },
        data: {
          status: PaymentStatus.REJECTED,
          rejectedAt: new Date(),
          rejectedById: actorId,
          rejectionReason: dto.reason,
        },
      });
      if (count === 0) {
        await this.throwNotPendingConflict(tx, id);
      }

      const payment = await tx.payment.findUniqueOrThrow({
        where: { id },
        include: PAYMENT_INCLUDE,
      });
      const customer = await tx.customer.findUniqueOrThrow({
        where: { id: payment.customerId },
        select: { debtBalance: true },
      });

      return { payment: toPaymentRow(payment), debtBalance: customer.debtBalance.toFixed(2) };
    });
  }

  private async throwNotPendingConflict(
    client: Prisma.TransactionClient,
    id: string,
  ): Promise<never> {
    const existing = await client.payment.findUnique({
      where: { id },
      select: { status: true, voidedAt: true },
    });
    if (existing === null) {
      throw new NotFoundException(`El pago "${id}" no existe`);
    }
    // Un cobro anulado sigue PENDING: anular no cambia el estado. Decir "ya
    // está en estado PENDING" mandaría a la oficina a reintentar para siempre,
    // así que el motivo real se nombra primero.
    if (existing.voidedAt !== null) {
      throw new ConflictException(
        "Este cobro fue anulado junto con su entrega: no se puede confirmar ni rechazar",
      );
    }
    throw new ConflictException(`Este pago ya está en estado ${existing.status}`);
  }
}
