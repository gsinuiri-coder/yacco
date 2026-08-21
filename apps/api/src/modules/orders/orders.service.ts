import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { OrderStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service.js";
import type { CreateOrderDto } from "./dto/create-order.dto.js";
import type { ListOrdersQueryDto } from "./dto/list-orders-query.dto.js";
import type { OrderResponseDto, PaginatedOrdersDto } from "./dto/order-response.dto.js";

/** Everything the wire shape needs, and nothing else. */
const ORDER_INCLUDE = {
  customer: { select: { id: true, name: true, phone: true } },
  items: { include: { product: { select: { id: true, name: true } } } },
} satisfies Prisma.OrderInclude;

type OrderWithRelations = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

/**
 * `orders.delivery_date` is a calendar DATE in America/Lima, not an instant.
 * Both helpers work in UTC on purpose: building the Date from local parts
 * would let the server's timezone shift the business day by one.
 */
export function parseBusinessDate(value: string, field: string): Date {
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const parsed = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC rolls overflow forward (Feb 31 -> Mar 3), so a round-trip is what
  // separates a real calendar day from a well-formed but impossible one.
  if (formatBusinessDate(parsed) !== value) {
    throw new BadRequestException(`${field} no es una fecha válida del calendario`);
  }
  return parsed;
}

export function formatBusinessDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function toOrderResponse(order: OrderWithRelations): OrderResponseDto {
  return {
    id: order.id,
    customerId: order.customerId,
    customer: order.customer,
    deliveryDate: formatBusinessDate(order.deliveryDate),
    status: order.status,
    createdById: order.createdById,
    createdAt: order.createdAt,
    items: order.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      product: item.product,
      quantity: item.quantity,
      unitPrice: item.unitPrice.toFixed(2),
    })),
  };
}

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * An order is always born PENDING (spec HU-06 E1); the transitions to
   * ON_ROUTE/DELIVERED/FAILED belong to the routes module. `createdById` is
   * the authenticated user, resolved by the controller from the access token.
   *
   * Customer and products are checked before the insert so the caller gets a
   * message naming what is missing, instead of a raw foreign-key violation.
   *
   * Both are also checked for `active`. This is office entry, not field
   * capture: a deactivated customer or a withdrawn product is a deliberate
   * decision someone took, and taking an order against it would quietly undo
   * that decision. A merely dormant customer (no recent orders) still has
   * active = true, so reactivating one over the phone is unaffected.
   */
  async create(dto: CreateOrderDto, createdById: string): Promise<OrderResponseDto> {
    const deliveryDate = parseBusinessDate(dto.deliveryDate, "La fecha de entrega");

    const order = await this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({
        where: { id: dto.customerId },
        select: { id: true, name: true, active: true },
      });
      if (customer === null) {
        throw new BadRequestException(`El cliente "${dto.customerId}" no existe`);
      }
      if (!customer.active) {
        throw new BadRequestException(
          `El cliente "${customer.name}" está desactivado; reactívalo antes de tomarle un pedido`,
        );
      }

      const requestedProductIds = [...new Set(dto.items.map((item) => item.productId))];
      const products = await tx.product.findMany({
        where: { id: { in: requestedProductIds } },
        select: { id: true, name: true, active: true },
      });
      if (products.length !== requestedProductIds.length) {
        const found = new Set(products.map((product) => product.id));
        const missing = requestedProductIds.filter((id) => !found.has(id));
        throw new BadRequestException(`No existen los productos: ${missing.join(", ")}`);
      }

      const inactive = products.filter((product) => !product.active);
      if (inactive.length > 0) {
        const names = inactive.map((product) => `"${product.name}"`).join(", ");
        throw new BadRequestException(`Ya no están a la venta los productos: ${names}`);
      }

      return tx.order.create({
        data: {
          customerId: dto.customerId,
          deliveryDate,
          createdById,
          items: {
            create: dto.items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: new Prisma.Decimal(item.unitPrice),
            })),
          },
        },
        include: ORDER_INCLUDE,
      });
    });

    return toOrderResponse(order);
  }

  /** Always paginated; the count runs against the same filter as the page. */
  async findAll(query: ListOrdersQueryDto): Promise<PaginatedOrdersDto> {
    const { page, limit } = query;
    const where = buildOrderFilter(query);

    const [total, orders] = await this.prisma.$transaction([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        include: ORDER_INCLUDE,
        orderBy: [{ deliveryDate: "asc" }, { createdAt: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: orders.map(toOrderResponse),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string): Promise<OrderResponseDto> {
    const order = await this.prisma.order.findUnique({ where: { id }, include: ORDER_INCLUDE });
    if (order === null) {
      throw new NotFoundException(`El pedido "${id}" no existe`);
    }
    return toOrderResponse(order);
  }

  /**
   * PENDING -> CANCELLED, and nothing else. Once a route has picked the order
   * up, only the routes module may move it, so cancelling here would silently
   * contradict what the driver is holding.
   *
   * The status guard lives in the WHERE clause rather than in a prior read:
   * a check-then-update could be overtaken by a route being planned in
   * between, and would cancel an order that is already ON_ROUTE.
   */
  async cancel(id: string): Promise<OrderResponseDto> {
    const { count } = await this.prisma.order.updateMany({
      where: { id, status: OrderStatus.PENDING },
      data: { status: OrderStatus.CANCELLED },
    });

    if (count === 0) {
      const existing = await this.prisma.order.findUnique({
        where: { id },
        select: { status: true },
      });
      if (existing === null) {
        throw new NotFoundException(`El pedido "${id}" no existe`);
      }
      throw new ConflictException(
        `Solo se puede cancelar un pedido pendiente; este está en ${existing.status}`,
      );
    }

    return this.findOne(id);
  }
}

function buildOrderFilter(query: ListOrdersQueryDto): Prisma.OrderWhereInput {
  const { status, customerId, deliveryDateFrom, deliveryDateTo } = query;
  const from =
    deliveryDateFrom === undefined
      ? undefined
      : parseBusinessDate(deliveryDateFrom, "La fecha desde");
  const to =
    deliveryDateTo === undefined ? undefined : parseBusinessDate(deliveryDateTo, "La fecha hasta");

  if (from !== undefined && to !== undefined && from > to) {
    throw new BadRequestException("La fecha desde no puede ser posterior a la fecha hasta");
  }

  return {
    ...(status !== undefined ? { status } : {}),
    ...(customerId !== undefined ? { customerId } : {}),
    // Both ends inclusive: they are calendar days, not instants.
    ...(from !== undefined || to !== undefined
      ? {
          deliveryDate: {
            ...(from !== undefined ? { gte: from } : {}),
            ...(to !== undefined ? { lte: to } : {}),
          },
        }
      : {}),
  };
}
