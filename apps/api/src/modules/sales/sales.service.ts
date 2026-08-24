import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma, type Payment, type Sale } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service.js";
import type { CreateOpeningChargeDto } from "./dto/create-opening-charge.dto.js";
import type { CreateOpeningCreditDto } from "./dto/create-opening-credit.dto.js";

function isPrismaKnownError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function assertPositiveAmount(amount: string): Prisma.Decimal {
  const parsed = new Prisma.Decimal(amount);
  if (parsed.lte(0)) {
    throw new BadRequestException("El monto debe ser mayor que 0");
  }
  return parsed;
}

function assertNotFuture(date: Date, label: string): void {
  if (date.getTime() > Date.now()) {
    throw new BadRequestException(`${label} no puede ser futura`);
  }
}

async function assertCustomerActive(
  client: Prisma.TransactionClient,
  customerId: string,
): Promise<void> {
  const customer = await client.customer.findUnique({
    where: { id: customerId },
    select: { id: true, active: true },
  });
  if (customer === null) {
    throw new BadRequestException(`El cliente "${customerId}" no existe`);
  }
  if (!customer.active) {
    throw new BadRequestException(`El cliente "${customerId}" no está activo`);
  }
}

/**
 * Shared by both directions: the ledger gives one net figure per customer,
 * never both a charge and a credit, so creating either one first checks that
 * NEITHER already exists. Sale has no customerId column (it hangs off the
 * location), so finding its opening charge goes through the location
 * relation; Payment carries customerId directly.
 */
async function assertNoOpeningBalanceExists(
  client: Prisma.TransactionClient,
  customerId: string,
): Promise<void> {
  const [existingCharge, existingCredit] = await Promise.all([
    client.sale.findFirst({
      where: { isOpeningBalance: true, location: { customerId } },
      select: { id: true },
    }),
    client.payment.findFirst({
      where: { isOpeningBalance: true, customerId },
      select: { id: true },
    }),
  ]);
  if (existingCharge !== null) {
    throw new BadRequestException(
      `El cliente "${customerId}" ya tiene un cargo de apertura registrado`,
    );
  }
  if (existingCredit !== null) {
    throw new BadRequestException(
      `El cliente "${customerId}" ya tiene un abono de apertura registrado`,
    );
  }
}

async function getPrimaryLocationId(
  client: Prisma.TransactionClient,
  customerId: string,
): Promise<string> {
  const location = await client.customerLocation.findFirst({
    where: { customerId, isPrimary: true },
    select: { id: true },
  });
  if (location === null) {
    throw new BadRequestException(`El cliente "${customerId}" no tiene una locación principal`);
  }
  return location.id;
}

@Injectable()
export class SalesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Two write methods, nothing else: this PR only carries the debt/credit a
   * customer already had when the system went live. S4 will extend this
   * module with the normal sales path — it is not designed for that here.
   *
   * Neither method has a controller. Opening money enters only through the
   * customer-roster loader, the same reasoning as OPENING_BALANCE and
   * COUNT_ADJUSTMENT on the container side: if either could be registered by
   * hand, someone could invent debt on a customer or forgive it with no
   * paper behind it. `debtBalance` is a materialized aggregate over
   * sales/payments the same way `customer_container_balances` is over
   * `container_movements` — nothing writes it outside this module, and this
   * PR is the first thing that ever does.
   *
   * `debtBalance` is a single-column-keyed row (`Customer.id`), unlike
   * `CustomerContainerBalance`'s composite key: the S2 bug that upsert's
   * `increment` silently overwrote instead of adding to
   * (`ContainerMovementsService.createWithinTransaction`) was specific to
   * that composite-key upsert path. A plain `update` with `increment` on a
   * single-column-keyed row applies correctly, so both methods below use it
   * without the read-then-write-absolute workaround — copying that pattern
   * here by cargo cult would be needless complexity.
   */
  async createOpeningCharge(dto: CreateOpeningChargeDto, recordedById: string): Promise<Sale> {
    const total = assertPositiveAmount(dto.amount);
    assertNotFuture(dto.soldAt, "La fecha de la venta");

    return this.prisma.$transaction(async (tx) => {
      await assertCustomerActive(tx, dto.customerId);
      await assertNoOpeningBalanceExists(tx, dto.customerId);
      const locationId = await getPrimaryLocationId(tx, dto.customerId);

      const sale = await tx.sale.create({
        data: {
          locationId,
          stopId: null,
          soldAt: dto.soldAt,
          total,
          // Not a credit-limit decision anyone made — this debt was already
          // there when the system started, so there is no "exceeded the
          // limit" moment to flag.
          creditLimitExceeded: false,
          isOpeningBalance: true,
          recordedById,
        },
      });

      await tx.customer.update({
        where: { id: dto.customerId },
        data: { debtBalance: { increment: total } },
      });

      return sale;
    });
  }

  async createOpeningCredit(dto: CreateOpeningCreditDto, recordedById: string): Promise<Payment> {
    const amount = assertPositiveAmount(dto.amount);
    assertNotFuture(dto.paidAt, "La fecha del pago");

    try {
      return await this.prisma.$transaction(async (tx) => {
        await assertCustomerActive(tx, dto.customerId);
        await assertNoOpeningBalanceExists(tx, dto.customerId);

        const payment = await tx.payment.create({
          data: {
            customerId: dto.customerId,
            locationId: null,
            saleId: null,
            stopId: null,
            paymentMethodId: dto.paymentMethodId,
            paidAt: dto.paidAt,
            amount,
            isOpeningBalance: true,
            recordedById,
          },
        });

        await tx.customer.update({
          where: { id: dto.customerId },
          data: { debtBalance: { decrement: amount } },
        });

        return payment;
      });
    } catch (error) {
      // P2003: the only FK this method doesn't pre-validate is paymentMethodId.
      if (isPrismaKnownError(error, "P2003")) {
        throw new BadRequestException(`El método de pago "${dto.paymentMethodId}" no existe`);
      }
      throw error;
    }
  }
}
