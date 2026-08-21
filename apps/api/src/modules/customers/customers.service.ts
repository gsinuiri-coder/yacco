import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service.js";
import type { CreateCustomerDto } from "./dto/create-customer.dto.js";
import type { CustomerResponseDto, PaginatedCustomersDto } from "./dto/customer-response.dto.js";
import type { ListCustomersQueryDto } from "./dto/list-customers-query.dto.js";
import type { UpdateCustomerDto } from "./dto/update-customer.dto.js";

function isPrismaKnownError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

/** Everything the wire shape needs, and nothing else. */
const CUSTOMER_INCLUDE = {
  zone: { select: { id: true, name: true } },
} satisfies Prisma.CustomerInclude;

type CustomerWithZone = Prisma.CustomerGetPayload<{ include: typeof CUSTOMER_INCLUDE }>;

/**
 * Maps a row to the wire shape. `debtBalance` and `creditLimit` come out as
 * fixed 2-decimal strings: a NUMERIC(10,2) must never round-trip through a
 * JSON number, which is an IEEE-754 double.
 */
function toCustomerResponse(customer: CustomerWithZone): CustomerResponseDto {
  return {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    address: customer.address,
    addressReference: customer.addressReference,
    zoneId: customer.zoneId,
    zone: customer.zone,
    creditLimit: customer.creditLimit === null ? null : customer.creditLimit.toFixed(2),
    debtBalance: customer.debtBalance.toFixed(2),
    active: customer.active,
    createdAt: customer.createdAt,
  };
}

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `debtBalance` is not accepted here and is not passed to Prisma: a new
   * customer always starts at the column default of 0 (spec HU-05 E1).
   */
  async create(dto: CreateCustomerDto): Promise<CustomerResponseDto> {
    try {
      const customer = await this.prisma.customer.create({
        data: {
          name: dto.name,
          phone: dto.phone,
          address: dto.address,
          addressReference: dto.addressReference,
          zoneId: dto.zoneId ?? null,
          creditLimit: dto.creditLimit === undefined ? null : new Prisma.Decimal(dto.creditLimit),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
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
    try {
      const customer = await this.prisma.customer.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
          ...(dto.address !== undefined ? { address: dto.address } : {}),
          ...(dto.addressReference !== undefined ? { addressReference: dto.addressReference } : {}),
          ...(dto.zoneId !== undefined ? { zoneId: dto.zoneId } : {}),
          ...(dto.creditLimit !== undefined
            ? { creditLimit: new Prisma.Decimal(dto.creditLimit) }
            : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
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

/** Search matches name or phone; zone and active narrow it further. */
function buildCustomerFilter(query: ListCustomersQueryDto): Prisma.CustomerWhereInput {
  const { search, zoneId, active } = query;
  return {
    ...(zoneId !== undefined ? { zoneId } : {}),
    ...(active !== undefined ? { active } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: Prisma.QueryMode.insensitive } },
            { phone: { contains: search } },
          ],
        }
      : {}),
  };
}
