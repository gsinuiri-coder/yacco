import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { OrderStatus, Prisma } from "@prisma/client";
import { LIVE_SALE_ITEMS, toDeliveredItems } from "../../common/delivery-lines.js";
import { isOffice } from "../../common/viewer.js";
import type { Viewer } from "../../common/viewer.js";
import { ORDER_STATUS_LABELS } from "../../common/status-labels.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import type { CreateOrderDto } from "./dto/create-order.dto.js";
import type {
  CreateLocationOrderDto,
  CreateOrdersBatchDto,
} from "./dto/create-orders-batch.dto.js";
import type { ListOrdersQueryDto } from "./dto/list-orders-query.dto.js";
import type {
  OrderResponseDto,
  OrderSiblingDto,
  PaginatedOrdersDto,
} from "./dto/order-response.dto.js";
import type { RescheduleOrderDto } from "./dto/reschedule-order.dto.js";
import type { RescheduleOrdersByDateDto } from "./dto/reschedule-orders-by-date.dto.js";

/**
 * Everything the wire shape needs, and nothing else. The order's own
 * `customerId`/`customer` on the wire are derived from its location — an
 * order has no direct customer FK any more, only a location one (spec: an
 * order belongs to the location the truck delivers to).
 */
const ORDER_INCLUDE = {
  location: {
    select: {
      id: true,
      name: true,
      phone: true,
      customer: { select: { id: true, name: true } },
    },
  },
  items: { include: { product: { select: { id: true, name: true } } } },
  routeStop: {
    select: {
      failureReason: true,
    },
  },
  rescheduledFrom: {
    select: {
      id: true,
      deliveryDate: true,
    },
  },
  rescheduledTo: {
    select: {
      id: true,
      deliveryDate: true,
    },
  },
} satisfies Prisma.OrderInclude;

/**
 * El detalle de UN pedido, además, con lo que lleva la venta vigente de su
 * parada: «pedido» y «entregado» lado a lado. Los listados siguen con
 * `ORDER_INCLUDE` — ninguna pantalla lee lo entregado desde ahí.
 */
const ORDER_DETAIL_INCLUDE = {
  ...ORDER_INCLUDE,
  routeStop: {
    select: {
      failureReason: true,
      sales: LIVE_SALE_ITEMS,
    },
  },
} satisfies Prisma.OrderInclude;

const ORDER_GROUP_INCLUDE = {
  orders: { include: ORDER_INCLUDE },
} satisfies Prisma.OrderGroupInclude;

type OrderWithRelations = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;
type OrderGroupWithOrders = Prisma.OrderGroupGetPayload<{ include: typeof ORDER_GROUP_INCLUDE }>;

function isPrismaKnownError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

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

export function nextCalendarDay(day: string): string {
  const [year, month, dayOfMonth] = day.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(year, month - 1, dayOfMonth + 1));
  return formatBusinessDate(next);
}

export function formatCalendarDay(day: string): string {
  const [year, month, dayOfMonth] = day.split("-") as [string, string, string];
  return `${dayOfMonth}/${month}/${year}`;
}

/**
 * Sum of quantity × unitPrice across every item, in Decimal throughout: a
 * single float in this sum would break the money guarantee the whole project
 * stands on (CLAUDE.md).
 */
function computeOrderTotal(items: { quantity: number; unitPrice: Prisma.Decimal }[]): string {
  return items
    .reduce((sum, item) => sum.plus(item.unitPrice.times(item.quantity)), new Prisma.Decimal(0))
    .toFixed(2);
}

function toOrderResponse(
  order: OrderWithRelations,
  siblingOrders: OrderSiblingDto[] = [],
): OrderResponseDto {
  return {
    id: order.id,
    locationId: order.locationId,
    location: {
      id: order.location.id,
      name: order.location.name,
    },
    orderGroupId: order.orderGroupId,
    rescheduledFromOrderId: order.rescheduledFromOrderId,
    rescheduledFrom: order.rescheduledFrom
      ? {
          id: order.rescheduledFrom.id,
          deliveryDate: formatBusinessDate(order.rescheduledFrom.deliveryDate),
        }
      : null,
    rescheduledTo: order.rescheduledTo
      ? {
          id: order.rescheduledTo.id,
          deliveryDate: formatBusinessDate(order.rescheduledTo.deliveryDate),
        }
      : null,
    failureReason: order.routeStop?.failureReason ?? null,
    customerId: order.location.customer.id,
    customer: { ...order.location.customer, phone: order.location.phone },
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
    siblingOrders,
    total: computeOrderTotal(order.items),
  };
}

function sameOrderItems(
  persisted: OrderWithRelations["items"],
  requested: CreateLocationOrderDto["items"],
): boolean {
  if (persisted.length !== requested.length) return false;
  const persistedLines = persisted
    .map((item) => `${item.productId}|${item.quantity}|${item.unitPrice.toFixed(2)}`)
    .sort((a, b) => a.localeCompare(b));
  const requestedLines = requested
    .map(
      (item) =>
        `${item.productId}|${item.quantity}|${new Prisma.Decimal(item.unitPrice).toFixed(2)}`,
    )
    .sort((a, b) => a.localeCompare(b));
  return persistedLines.every((line, index) => line === requestedLines[index]);
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

      // No location is chosen yet (a future phase adds that): an order always
      // lands at the customer's primary location. Every customer has exactly
      // one (created atomically with the customer, enforced by a partial
      // unique index), so this is a defensive guard, not an expected path.
      const primaryLocation = await tx.customerLocation.findFirst({
        where: { customerId: dto.customerId, isPrimary: true },
        select: { id: true },
      });
      if (primaryLocation === null) {
        throw new BadRequestException(
          `El cliente "${customer.name}" no tiene una ubicación principal`,
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
          locationId: primaryLocation.id,
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

  /**
   * Creates one linked order per location that carries at least one item.
   * The group row and every order/item commit in one transaction, so an
   * invalid second location never leaves the first one behind.
   */
  async createBatch(dto: CreateOrdersBatchDto, createdById: string): Promise<OrderResponseDto[]> {
    const deliveryDate = parseBusinessDate(dto.deliveryDate, "La fecha de entrega");
    const requestedLocations = dto.locations.filter((location) => location.items.length > 0);
    if (requestedLocations.length === 0) {
      throw new BadRequestException("Ingresa al menos un producto en uno de los locales");
    }

    if (dto.idempotencyKey !== undefined) {
      const existing = await this.prisma.orderGroup.findUnique({
        where: { idempotencyKey: dto.idempotencyKey },
        include: ORDER_GROUP_INCLUDE,
      });
      if (existing !== null) {
        return this.buildBatchReplay(existing, dto, deliveryDate);
      }
    }

    try {
      const orders = await this.prisma.$transaction(async (tx) => {
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

        const locationIds = dto.locations.map((location) => location.locationId);
        const locations = await tx.customerLocation.findMany({
          where: { id: { in: locationIds } },
          select: { id: true, name: true, customerId: true, active: true },
        });
        const foundLocationIds = new Set(locations.map((location) => location.id));
        const missingLocationIds = locationIds.filter((id) => !foundLocationIds.has(id));
        if (missingLocationIds.length > 0) {
          throw new BadRequestException(`No existen los locales: ${missingLocationIds.join(", ")}`);
        }
        const foreignLocation = locations.find(
          (location) => location.customerId !== dto.customerId,
        );
        if (foreignLocation !== undefined) {
          throw new BadRequestException(
            `El local "${foreignLocation.name}" no pertenece a este cliente`,
          );
        }
        const inactiveLocations = locations.filter((location) => !location.active);
        if (inactiveLocations.length > 0) {
          throw new BadRequestException(
            `Ya no están activos los locales: ${inactiveLocations
              .map((location) => `"${location.name}"`)
              .join(", ")}`,
          );
        }

        const requestedProductIds = [
          ...new Set(
            requestedLocations.flatMap((location) => location.items.map((item) => item.productId)),
          ),
        ];
        const products = await tx.product.findMany({
          where: { id: { in: requestedProductIds } },
          select: { id: true, name: true, active: true },
        });
        if (products.length !== requestedProductIds.length) {
          const found = new Set(products.map((product) => product.id));
          const missing = requestedProductIds.filter((id) => !found.has(id));
          throw new BadRequestException(`No existen los productos: ${missing.join(", ")}`);
        }
        const inactiveProducts = products.filter((product) => !product.active);
        if (inactiveProducts.length > 0) {
          throw new BadRequestException(
            `Ya no están a la venta los productos: ${inactiveProducts
              .map((product) => `"${product.name}"`)
              .join(", ")}`,
          );
        }

        const group = await tx.orderGroup.create({
          data: {
            customerId: dto.customerId,
            createdById,
            idempotencyKey: dto.idempotencyKey ?? null,
          },
        });
        const created: OrderWithRelations[] = [];
        for (const location of requestedLocations) {
          created.push(
            await tx.order.create({
              data: {
                locationId: location.locationId,
                orderGroupId: group.id,
                deliveryDate,
                createdById,
                items: {
                  create: location.items.map((item) => ({
                    productId: item.productId,
                    quantity: item.quantity,
                    unitPrice: new Prisma.Decimal(item.unitPrice),
                  })),
                },
              },
              include: ORDER_INCLUDE,
            }),
          );
        }
        return created;
      });

      return orders.map((order) => {
        const siblings = orders
          .filter((other) => other.id !== order.id)
          .map((other) => ({
            id: other.id,
            locationId: other.locationId,
            locationName: other.location.name,
          }));
        return toOrderResponse(order, siblings);
      });
    } catch (error) {
      if (dto.idempotencyKey !== undefined && isPrismaKnownError(error, "P2002")) {
        const existing = await this.prisma.orderGroup.findUniqueOrThrow({
          where: { idempotencyKey: dto.idempotencyKey },
          include: ORDER_GROUP_INCLUDE,
        });
        return this.buildBatchReplay(existing, dto, deliveryDate);
      }
      throw error;
    }
  }

  private buildBatchReplay(
    existing: OrderGroupWithOrders,
    dto: CreateOrdersBatchDto,
    deliveryDate: Date,
  ): OrderResponseDto[] {
    const requestedLocations = dto.locations.filter((location) => location.items.length > 0);
    const existingByLocation = new Map(
      existing.orders.map((order) => [order.locationId, order] as const),
    );
    const sameRequest =
      existing.customerId === dto.customerId &&
      existing.orders.length === requestedLocations.length &&
      requestedLocations.every((location) => {
        const order = existingByLocation.get(location.locationId);
        return (
          order !== undefined &&
          order.deliveryDate.getTime() === deliveryDate.getTime() &&
          sameOrderItems(order.items, location.items)
        );
      });
    if (!sameRequest) {
      throw new ConflictException(
        `La clave de idempotencia "${dto.idempotencyKey}" ya se usó para otro pedido. Genera una clave nueva para este envío.`,
      );
    }
    return requestedLocations.map((location) => {
      const order = existingByLocation.get(location.locationId) as OrderWithRelations;
      const siblings = existing.orders
        .filter((other) => other.id !== order.id)
        .map((other) => ({
          id: other.id,
          locationId: other.locationId,
          locationName: other.location.name,
        }));
      return toOrderResponse(order, siblings);
    });
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
      data: orders.map((order) => toOrderResponse(order)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Un chofer ve un pedido solo si es la parada de una ruta suya. Si no, para
   * él no existe: 404 igual que un id que no está, sin confirmar que haya un
   * pedido con ese id de otro chofer.
   */
  async findOne(id: string, viewer?: Viewer): Promise<OrderResponseDto> {
    const onlyOwnRoutes =
      viewer !== undefined && !isOffice(viewer)
        ? { routeStop: { route: { driverId: viewer.id } } }
        : {};
    const order = await this.prisma.order.findFirst({
      where: { id, ...onlyOwnRoutes },
      include: ORDER_DETAIL_INCLUDE,
    });
    if (order === null) {
      throw new NotFoundException(`El pedido "${id}" no existe`);
    }

    let siblingOrders: OrderSiblingDto[] = [];
    if (order.orderGroupId !== null) {
      const siblings = await this.prisma.order.findMany({
        where: {
          orderGroupId: order.orderGroupId,
          id: { not: order.id },
        },
        select: {
          id: true,
          locationId: true,
          location: { select: { name: true } },
        },
        orderBy: { createdAt: "asc" },
      });
      siblingOrders = siblings.map((sibling) => ({
        id: sibling.id,
        locationId: sibling.locationId,
        locationName: sibling.location.name,
      }));
    }

    return {
      ...toOrderResponse(order, siblingOrders),
      deliveredItems: toDeliveredItems(order.routeStop?.sales),
    };
  }

  /**
   * PENDING -> CANCELLED, and nothing else. Once a route has picked the order
   * up, only the routes module may move it, so cancelling here would silently
   * contradict what the driver is holding.
   *
   * The status guard lives in the WHERE clause rather than in a prior read:
   * a check-then-update could be overtaken by a route being planned in
   * between, and would cancel an order that is already ON_ROUTE.
   *
   * Esa protección estuvo escrita e INERTE hasta que el pedido empezó a seguir
   * a su parada: nadie escribía `ON_ROUTE`, así que un pedido asignado seguía
   * en PENDING y esta guarda lo dejaba cancelar igual, con el chofer llevándolo
   * en la hoja de ruta. Desde `RoutesService.addStop` sí lo escribe, y el test
   * de integración «cancelar un pedido ya asignado devuelve 409» es lo que
   * impide que vuelva a quedar inerte sin que nada avise.
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
        `Solo se puede cancelar un pedido pendiente; este está ${ORDER_STATUS_LABELS[existing.status]}`,
      );
    }

    return this.findOne(id);
  }

  /**
   * Reschedules an un-delivered (FAILED) order by creating a new PENDING order
   * for the same location with the same items and exact unit prices.
   * Defaults to the next calendar day in America/Lima.
   * Can only be rescheduled once; subsequent attempts fail with ConflictException.
   */
  async reschedule(
    id: string,
    dto: RescheduleOrderDto,
    createdById: string,
  ): Promise<OrderResponseDto> {
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const order = await tx.order.findUnique({
          where: { id },
          include: {
            ...ORDER_INCLUDE,
            rescheduledTo: { select: { id: true, deliveryDate: true } },
          },
        });
        if (order === null) {
          throw new NotFoundException(`El pedido "${id}" no existe`);
        }
        if (order.status !== OrderStatus.FAILED) {
          throw new ConflictException(
            `Solo se puede reprogramar un pedido no entregado; este está ${ORDER_STATUS_LABELS[order.status]}`,
          );
        }
        if (order.rescheduledTo !== null) {
          throw new ConflictException(
            `El pedido ya fue reprogramado para el ${formatCalendarDay(formatBusinessDate(order.rescheduledTo.deliveryDate))}`,
          );
        }

        const targetDeliveryDate =
          dto.deliveryDate !== undefined
            ? parseBusinessDate(dto.deliveryDate, "La fecha de entrega")
            : parseBusinessDate(
                nextCalendarDay(formatBusinessDate(order.deliveryDate)),
                "La fecha de entrega",
              );

        return tx.order.create({
          data: {
            locationId: order.locationId,
            deliveryDate: targetDeliveryDate,
            status: OrderStatus.PENDING,
            rescheduledFromOrderId: order.id,
            createdById,
            items: {
              create: order.items.map((item) => ({
                productId: item.productId,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
              })),
            },
          },
          include: ORDER_INCLUDE,
        });
      });

      return toOrderResponse(created);
    } catch (error) {
      if (isPrismaKnownError(error, "P2002")) {
        throw new ConflictException("Este pedido ya fue reprogramado");
      }
      throw error;
    }
  }

  /**
   * Reschedules all FAILED orders of a given delivery date in a single transaction.
   * If any order was already rescheduled, the entire operation is rolled back and rejected.
   */
  async rescheduleByDate(
    dto: RescheduleOrdersByDateDto,
    createdById: string,
  ): Promise<OrderResponseDto[]> {
    const sourceDate = parseBusinessDate(dto.deliveryDate, "La fecha de origen");
    const targetDate =
      dto.newDeliveryDate !== undefined
        ? parseBusinessDate(dto.newDeliveryDate, "La nueva fecha de entrega")
        : parseBusinessDate(nextCalendarDay(dto.deliveryDate), "La nueva fecha de entrega");

    try {
      const createdOrders = await this.prisma.$transaction(async (tx) => {
        const orders = await tx.order.findMany({
          where: {
            deliveryDate: sourceDate,
            status: OrderStatus.FAILED,
          },
          include: {
            ...ORDER_INCLUDE,
            rescheduledTo: { select: { id: true, deliveryDate: true } },
          },
          orderBy: { createdAt: "asc" },
        });

        if (orders.length === 0) {
          throw new BadRequestException(
            `No existen pedidos no entregados en la fecha ${dto.deliveryDate}`,
          );
        }

        const alreadyRescheduled = orders.find((o) => o.rescheduledTo !== null);
        if (alreadyRescheduled !== undefined) {
          throw new ConflictException(
            `Uno o más pedidos de la fecha ${dto.deliveryDate} ya fueron reprogramados`,
          );
        }

        const results: OrderWithRelations[] = [];
        for (const order of orders) {
          const created = await tx.order.create({
            data: {
              locationId: order.locationId,
              deliveryDate: targetDate,
              status: OrderStatus.PENDING,
              rescheduledFromOrderId: order.id,
              createdById,
              items: {
                create: order.items.map((item) => ({
                  productId: item.productId,
                  quantity: item.quantity,
                  unitPrice: item.unitPrice,
                })),
              },
            },
            include: ORDER_INCLUDE,
          });
          results.push(created);
        }

        return results;
      });

      return createdOrders.map((order) => toOrderResponse(order));
    } catch (error) {
      if (isPrismaKnownError(error, "P2002")) {
        throw new ConflictException("Uno o más pedidos de la fecha ya fueron reprogramados");
      }
      throw error;
    }
  }
}

function buildOrderFilter(query: ListOrdersQueryDto): Prisma.OrderWhereInput {
  const {
    status,
    excludeCancelled,
    customerId,
    zoneId,
    deliveryDateFrom,
    deliveryDateTo,
    hasRouteStop,
    isRescheduled,
  } = query;
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
    ...(status !== undefined
      ? { status }
      : excludeCancelled === true
        ? { status: { not: OrderStatus.CANCELLED } }
        : {}),
    // Los dos miran al cliente del pedido; juntos, las dos condiciones valen.
    ...(customerId !== undefined || zoneId !== undefined
      ? {
          location: {
            ...(customerId !== undefined ? { customerId } : {}),
            ...(zoneId !== undefined ? { customer: { zoneId } } : {}),
          },
        }
      : {}),
    // `routeStop` es una relación uno-a-uno opcional (route_stops.order_id es
    // UNIQUE), así que "sin parada asignada" se pregunta por la relación, no
    // por una columna de Order: no existe tal columna.
    ...(hasRouteStop !== undefined
      ? { routeStop: hasRouteStop ? { isNot: null } : { is: null } }
      : {}),
    ...(isRescheduled !== undefined
      ? { rescheduledTo: isRescheduled ? { isNot: null } : { is: null } }
      : {}),
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
