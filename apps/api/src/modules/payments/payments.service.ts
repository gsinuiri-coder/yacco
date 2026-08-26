import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PaymentStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service.js";
import type {
  PaginatedPaymentsDto,
  PaymentActionResponseDto,
  PaymentRowDto,
} from "./dto/payment-response.dto.js";
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
  const { status, paymentMethodId, customerId, paidFrom, paidTo } = query;
  const from = paidFrom === undefined ? undefined : new Date(paidFrom);
  const to = paidTo === undefined ? undefined : new Date(paidTo);

  if (from !== undefined && to !== undefined && from > to) {
    throw new BadRequestException("La fecha desde no puede ser posterior a la fecha hasta");
  }

  return {
    ...(status !== undefined ? { status } : {}),
    ...(paymentMethodId !== undefined ? { paymentMethodId } : {}),
    ...(customerId !== undefined ? { customerId } : {}),
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

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The office's confirmation tray: every payment, oldest paidAt first — the
   * longest-unconfirmed one is the riskiest, so it leads. `totals` is
   * computed with the SAME `where` as the page, via a separate `aggregate`,
   * not derived from `data`: the office needs "how much Yape is sitting
   * unconfirmed today" across the whole filtered set, not just the 20 rows
   * on screen.
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
   */
  async confirm(id: string, actorId: string): Promise<PaymentActionResponseDto> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.payment.updateMany({
        where: { id, status: PaymentStatus.PENDING },
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
   * PENDING -> REJECTED. Same idempotent guard as confirm(), but this one
   * touches no balance at all: a PENDING payment never reduced debtBalance,
   * so there is nothing here to put back.
   */
  async reject(
    id: string,
    dto: RejectPaymentDto,
    actorId: string,
  ): Promise<PaymentActionResponseDto> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.payment.updateMany({
        where: { id, status: PaymentStatus.PENDING },
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
    const existing = await client.payment.findUnique({ where: { id }, select: { status: true } });
    if (existing === null) {
      throw new NotFoundException(`El pago "${id}" no existe`);
    }
    throw new ConflictException(`Este pago ya está en estado ${existing.status}`);
  }
}
