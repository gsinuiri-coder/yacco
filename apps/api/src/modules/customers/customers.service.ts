import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PaymentStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service.js";
import type { AccountStatementQueryDto } from "./dto/account-statement-query.dto.js";
import type {
  AccountStatementEntryDto,
  AccountStatementResponseDto,
} from "./dto/account-statement-response.dto.js";
import type { CreateCustomerDto } from "./dto/create-customer.dto.js";
import type { CustomerResponseDto, PaginatedCustomersDto } from "./dto/customer-response.dto.js";
import type { ListCustomersQueryDto } from "./dto/list-customers-query.dto.js";
import type { UpdateCustomerDto } from "./dto/update-customer.dto.js";

function isPrismaKnownError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

/**
 * Lima has no DST and sits at UTC-5, so its midnight is always 05:00 UTC.
 * `soldAt`/`paidAt` are timestamptz; a "from/to" filter on them is a business
 * day (CLAUDE.md), so both ends are converted to their UTC instant boundary
 * here rather than compared as naive dates. Copied rather than imported —
 * same reasoning as ContainerMovementsService's own copy of this helper.
 */
function limaDayStartUtc(date: string): Date {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day, 5, 0, 0));
}

interface StatementMovement {
  date: Date;
  type: "CHARGE" | "PAYMENT";
  amount: Prisma.Decimal;
  /** Signed effect on the balance: +amount for a charge, -amount for a
   * CONFIRMED payment, 0 for a PENDING or REJECTED one — and 0 for anything
   * voided, whichever of the two it is. */
  effect: Prisma.Decimal;
  isOpeningBalance: boolean;
  saleId: string | null;
  locationName: string | null;
  paymentId: string | null;
  paymentMethodName: string | null;
  status: PaymentStatus | null;
  voidedAt: Date | null;
}

/**
 * Everything the wire shape needs, and nothing else. `locations` pulls only
 * the primary one: address/phone/reference live there now (never duplicated
 * onto Customer itself), and every customer has exactly one primary location
 * by construction (see `create` below and the partial unique index in the
 * migration).
 */
const CUSTOMER_INCLUDE = {
  zone: { select: { id: true, name: true } },
  locations: { where: { isPrimary: true }, take: 1 },
} satisfies Prisma.CustomerInclude;

type CustomerWithRelations = Prisma.CustomerGetPayload<{ include: typeof CUSTOMER_INCLUDE }>;

/**
 * Maps a row to the wire shape. `debtBalance` and `creditLimit` come out as
 * fixed 2-decimal strings: a NUMERIC(10,2) must never round-trip through a
 * JSON number, which is an IEEE-754 double.
 */
function toCustomerResponse(customer: CustomerWithRelations): CustomerResponseDto {
  const primaryLocation = customer.locations[0];
  if (primaryLocation === undefined) {
    // Would mean the invariant "every customer has a primary location" was
    // violated somewhere else; surfacing it loudly beats returning a
    // half-built response with an undefined address.
    throw new Error(`El cliente "${customer.id}" no tiene una ubicación principal`);
  }

  return {
    id: customer.id,
    name: customer.name,
    phone: primaryLocation.phone,
    address: primaryLocation.address,
    addressReference: primaryLocation.addressReference,
    zoneId: customer.zoneId,
    zone: customer.zone,
    creditLimit: customer.creditLimit === null ? null : customer.creditLimit.toFixed(2),
    debtBalance: customer.debtBalance.toFixed(2),
    active: customer.active,
    createdAt: customer.createdAt,
    externalCode: customer.externalCode,
  };
}

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `debtBalance` is not accepted here and is not passed to Prisma: a new
   * customer always starts at the column default of 0 (spec HU-05 E1).
   *
   * The primary location is created in the same nested write — Prisma runs a
   * nested `create` as part of the same transaction as its parent — so a
   * customer never exists even briefly without one.
   */
  async create(dto: CreateCustomerDto): Promise<CustomerResponseDto> {
    try {
      const customer = await this.prisma.customer.create({
        data: {
          name: dto.name,
          zoneId: dto.zoneId ?? null,
          creditLimit: dto.creditLimit === undefined ? null : new Prisma.Decimal(dto.creditLimit),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
          locations: {
            create: {
              name: "Principal",
              address: dto.address,
              addressReference: dto.addressReference,
              phone: dto.phone,
              isPrimary: true,
            },
          },
        },
        include: CUSTOMER_INCLUDE,
      });
      return toCustomerResponse(customer);
    } catch (error) {
      // P2003: the zone FK points at a zone that does not exist.
      if (isPrismaKnownError(error, "P2003")) {
        throw new BadRequestException(`La zona "${dto.zoneId}" no existe`);
      }
      throw error;
    }
  }

  /**
   * Always paginated: the roster is large enough that returning every row
   * would be a mistake, so `limit` is capped by the query DTO and the count
   * runs against the same filter the page does.
   */
  async findAll(query: ListCustomersQueryDto): Promise<PaginatedCustomersDto> {
    const { page, limit } = query;
    const where = buildCustomerFilter(query);

    const [total, customers] = await this.prisma.$transaction([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        orderBy: { name: "asc" },
        skip: (page - 1) * limit,
        take: limit,
        include: CUSTOMER_INCLUDE,
      }),
    ]);

    return {
      data: customers.map(toCustomerResponse),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * HU-18 E1's second clause: a payment must be visible in the account
   * statement, not just reflected in `debtBalance`. Reconstructs the ledger
   * from `Sale`/`Payment` rather than trusting `debtBalance` directly — the
   * whole point is a second opinion on that cached number, same spirit as
   * the container-reconciliation report.
   *
   * `Sale` has no `customerId` column, only `locationId`, so it joins
   * through `location: { customerId }`; `Payment` carries `customerId`
   * directly, so it doesn't need the join — the two queries are NOT
   * symmetric on purpose.
   *
   * A CONFIRMED payment subtracts its amount; a PENDING or REJECTED one
   * shows up in `entries` (so "I registered my Yape and my debt didn't
   * move" is visible, not silently hidden) but never touches the running
   * balance — exactly the rule every other aggregate in this system already
   * follows (`debtBalance`, route settlements, the confirmation tray).
   *
   * Una venta o un cobro ANULADOS siguen ese mismo idioma, y por la misma
   * razón: la fila aparece con su monto original y su `voidedAt`, pero su
   * efecto es cero y el saldo no se mueve. Es lo que hace visible "esto se
   * anotó y después se corrigió" en vez de esconderlo — y esconderlo sería
   * peor acá que en un pago PENDING, porque el cliente vio esa entrega y va
   * a preguntar por ella. La fila NUNCA se edita ni se borra (CLAUDE.md):
   * quien anula escribe `voidedAt`, y este método deja de contarla.
   *
   * `openingBalance`/`closingBalance` are computed over every movement in
   * the window, never truncated; `limit` only caps how many of the most
   * recent `entries` are returned, so the two balances stay correct even
   * when a customer's full history is longer than what the caller asked to
   * see.
   */
  async getAccountStatement(
    id: string,
    query: AccountStatementQueryDto,
  ): Promise<AccountStatementResponseDto> {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      select: { id: true, name: true, debtBalance: true },
    });
    if (customer === null) {
      throw new NotFoundException(`El cliente "${id}" no existe`);
    }

    const fromBoundary = query.from === undefined ? undefined : limaDayStartUtc(query.from);
    // "Hasta" is inclusive of the whole calendar day, so the upper bound is
    // the START of the FOLLOWING Lima day, compared with a strict `<`.
    const toBoundary =
      query.to === undefined
        ? undefined
        : new Date(limaDayStartUtc(query.to).getTime() + 24 * 60 * 60 * 1000);
    if (fromBoundary !== undefined && toBoundary !== undefined && fromBoundary >= toBoundary) {
      throw new BadRequestException("La fecha desde no puede ser posterior a la fecha hasta");
    }

    const [sales, payments] = await Promise.all([
      this.prisma.sale.findMany({
        where: {
          location: { customerId: id },
          ...(toBoundary !== undefined ? { soldAt: { lt: toBoundary } } : {}),
        },
        select: {
          id: true,
          soldAt: true,
          total: true,
          isOpeningBalance: true,
          voidedAt: true,
          location: { select: { name: true } },
        },
      }),
      this.prisma.payment.findMany({
        where: {
          customerId: id,
          ...(toBoundary !== undefined ? { paidAt: { lt: toBoundary } } : {}),
        },
        select: {
          id: true,
          paidAt: true,
          amount: true,
          status: true,
          isOpeningBalance: true,
          voidedAt: true,
          paymentMethod: { select: { name: true } },
        },
      }),
    ]);

    const movements: StatementMovement[] = [
      ...sales.map((sale): StatementMovement => ({
        date: sale.soldAt,
        type: "CHARGE",
        amount: sale.total,
        effect: sale.voidedAt === null ? sale.total : new Prisma.Decimal(0),
        isOpeningBalance: sale.isOpeningBalance,
        saleId: sale.id,
        locationName: sale.location.name,
        paymentId: null,
        paymentMethodName: null,
        status: null,
        voidedAt: sale.voidedAt,
      })),
      ...payments.map((payment): StatementMovement => ({
        date: payment.paidAt,
        type: "PAYMENT",
        amount: payment.amount,
        effect:
          payment.voidedAt === null && payment.status === PaymentStatus.CONFIRMED
            ? payment.amount.negated()
            : new Prisma.Decimal(0),
        isOpeningBalance: payment.isOpeningBalance,
        saleId: null,
        locationName: null,
        paymentId: payment.id,
        paymentMethodName: payment.paymentMethod.name,
        status: payment.status,
        voidedAt: payment.voidedAt,
      })),
    ].sort((a, b) => a.date.getTime() - b.date.getTime());

    let runningTotal = new Prisma.Decimal(0);
    let openingBalance = new Prisma.Decimal(0);
    let openingCaptured = fromBoundary === undefined;
    const entries: AccountStatementEntryDto[] = [];

    for (const movement of movements) {
      if (fromBoundary !== undefined && movement.date.getTime() < fromBoundary.getTime()) {
        runningTotal = runningTotal.plus(movement.effect);
        continue;
      }
      if (!openingCaptured) {
        openingBalance = runningTotal;
        openingCaptured = true;
      }
      runningTotal = runningTotal.plus(movement.effect);
      entries.push({
        date: movement.date,
        type: movement.type,
        amount: movement.amount.toFixed(2),
        runningBalance: runningTotal.toFixed(2),
        isOpeningBalance: movement.isOpeningBalance,
        saleId: movement.saleId,
        locationName: movement.locationName,
        paymentId: movement.paymentId,
        paymentMethodName: movement.paymentMethodName,
        status: movement.status,
        voidedAt: movement.voidedAt,
      });
    }
    // Every movement was before `from` (or there were none at all): the
    // window's opening balance is simply everything that happened.
    if (!openingCaptured) {
      openingBalance = runningTotal;
    }

    // Display-only cap: keeps the most recent entries, never the oldest —
    // the balances above already reflect the FULL window regardless of it.
    const visibleEntries =
      entries.length > query.limit ? entries.slice(entries.length - query.limit) : entries;

    return {
      customer: {
        id: customer.id,
        name: customer.name,
        debtBalance: customer.debtBalance.toFixed(2),
      },
      openingBalance: openingBalance.toFixed(2),
      entries: visibleEntries,
      closingBalance: runningTotal.toFixed(2),
    };
  }

  async findOne(id: string): Promise<CustomerResponseDto> {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: CUSTOMER_INCLUDE,
    });
    if (customer === null) {
      throw new NotFoundException(`El cliente "${id}" no existe`);
    }
    return toCustomerResponse(customer);
  }

  /**
   * Also the deactivation path (`active: false`). There is no hard delete:
   * every Customer relation is onDelete: Restrict, so removing the row would
   * fail as soon as the customer had an order, a sale or a movement — and the
   * ledgers must keep pointing at a customer that still exists.
   *
   * `debtBalance` is absent from UpdateCustomerDto, so no field written here
   * can move it.
   */
  async update(id: string, dto: UpdateCustomerDto): Promise<CustomerResponseDto> {
    // address/addressReference/phone live on the primary location now; a
    // nested updateMany (scoped to isPrimary, never more than one row) moves
    // them in the same transaction as the customer's own fields, so a patch
    // that touches both never leaves one written without the other.
    const locationPatch = {
      ...(dto.address !== undefined ? { address: dto.address } : {}),
      ...(dto.addressReference !== undefined ? { addressReference: dto.addressReference } : {}),
      ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
    };

    try {
      const customer = await this.prisma.customer.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.zoneId !== undefined ? { zoneId: dto.zoneId } : {}),
          ...(dto.creditLimit !== undefined
            ? { creditLimit: new Prisma.Decimal(dto.creditLimit) }
            : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
          ...(Object.keys(locationPatch).length > 0
            ? { locations: { updateMany: { where: { isPrimary: true }, data: locationPatch } } }
            : {}),
        },
        include: CUSTOMER_INCLUDE,
      });
      return toCustomerResponse(customer);
    } catch (error) {
      if (isPrismaKnownError(error, "P2025")) {
        throw new NotFoundException(`El cliente "${id}" no existe`);
      }
      if (isPrismaKnownError(error, "P2003")) {
        throw new BadRequestException(`La zona "${dto.zoneId}" no existe`);
      }
      throw error;
    }
  }
}

/**
 * Search matches name or phone; zone and active narrow it further. Phone
 * lives on the location now, so it matches against any of the customer's
 * locations — not just the primary one.
 */
function buildCustomerFilter(query: ListCustomersQueryDto): Prisma.CustomerWhereInput {
  const { search, zoneId, active } = query;
  return {
    ...(zoneId !== undefined ? { zoneId } : {}),
    ...(active !== undefined ? { active } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: Prisma.QueryMode.insensitive } },
            { locations: { some: { phone: { contains: search } } } },
          ],
        }
      : {}),
  };
}
