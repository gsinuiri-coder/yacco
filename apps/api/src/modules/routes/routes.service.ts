import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { OrderStatus, Prisma, RouteStatus, StopOrigin, StopStatus, UserRole } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service.js";
import { formatBusinessDate, parseBusinessDate } from "../orders/orders.service.js";
import type { CreateRouteDto } from "./dto/create-route.dto.js";
import type { CreateRouteStopDto } from "./dto/create-route-stop.dto.js";
import type { ListRoutesQueryDto } from "./dto/list-routes-query.dto.js";
import type { MarkRouteStopDto } from "./dto/mark-route-stop.dto.js";
import type { ReorderRouteStopsDto } from "./dto/reorder-route-stops.dto.js";
import type {
  PaginatedRoutesDto,
  RouteResponseDto,
  RouteStopResponseDto,
} from "./dto/route-response.dto.js";

/** Who is calling — resolved by the controller from the access token. */
export interface RouteActor {
  id: string;
  roles: UserRole[];
}

function isPrismaKnownError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

const STOP_INCLUDE = {
  location: { select: { id: true, name: true, address: true } },
} satisfies Prisma.RouteStopInclude;

const ROUTE_INCLUDE = {
  driver: { select: { id: true, name: true } },
  zone: { select: { id: true, name: true } },
  stops: { include: STOP_INCLUDE, orderBy: { position: "asc" } },
} satisfies Prisma.RouteInclude;

type RouteWithRelations = Prisma.RouteGetPayload<{ include: typeof ROUTE_INCLUDE }>;
type StopWithRelations = Prisma.RouteStopGetPayload<{ include: typeof STOP_INCLUDE }>;

function toStopResponse(stop: StopWithRelations): RouteStopResponseDto {
  return {
    id: stop.id,
    routeId: stop.routeId,
    position: stop.position,
    origin: stop.origin,
    locationId: stop.locationId,
    location: stop.location,
    orderId: stop.orderId,
    status: stop.status,
    failureReason: stop.failureReason,
  };
}

function toRouteResponse(route: RouteWithRelations): RouteResponseDto {
  return {
    id: route.id,
    date: formatBusinessDate(route.date),
    driverId: route.driverId,
    driver: route.driver,
    zoneId: route.zoneId,
    zone: route.zone,
    status: route.status,
    createdById: route.createdById,
    createdAt: route.createdAt,
    stops: route.stops.map(toStopResponse),
  };
}

/** ADMIN and SELLER see and operate every route; a DRIVER only their own. */
function isPrivileged(actor: RouteActor): boolean {
  return actor.roles.includes(UserRole.ADMIN) || actor.roles.includes(UserRole.SELLER);
}

function assertCanAccessRoute(actor: RouteActor, route: { driverId: string }): void {
  if (!isPrivileged(actor) && route.driverId !== actor.id) {
    throw new ForbiddenException("Esta ruta es de otro chofer");
  }
}

@Injectable()
export class RoutesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Born PLANNED, always. `driverId` must name an active user with the
   * DRIVER role — checked here, before the insert, so a bad id or a
   * mis-assigned role comes back as a message naming the problem instead of
   * a foreign-key violation or a route silently assigned to a seller.
   *
   * `routes_driver_id_date_key` (one route per driver per day) is a real
   * unique constraint, not just an application check: a driver planned twice
   * for the same day under concurrent requests must be impossible, not just
   * unlikely.
   */
  async create(dto: CreateRouteDto, createdById: string): Promise<RouteResponseDto> {
    const date = parseBusinessDate(dto.date, "La fecha de la ruta");

    const driver = await this.prisma.user.findUnique({
      where: { id: dto.driverId },
      select: {
        id: true,
        name: true,
        active: true,
        roles: { select: { role: { select: { name: true } } } },
      },
    });
    if (driver === null) {
      throw new BadRequestException(`El usuario "${dto.driverId}" no existe`);
    }
    const isDriver = driver.roles.some((assignment) => assignment.role.name === UserRole.DRIVER);
    if (!isDriver) {
      throw new BadRequestException(`El usuario "${driver.name}" no tiene el rol de chofer`);
    }
    if (!driver.active) {
      throw new BadRequestException(`El chofer "${driver.name}" está desactivado`);
    }

    if (dto.zoneId !== undefined) {
      const zone = await this.prisma.zone.findUnique({
        where: { id: dto.zoneId },
        select: { id: true },
      });
      if (zone === null) {
        throw new BadRequestException(`La zona "${dto.zoneId}" no existe`);
      }
    }

    try {
      const route = await this.prisma.route.create({
        data: { driverId: dto.driverId, date, zoneId: dto.zoneId ?? null, createdById },
        include: ROUTE_INCLUDE,
      });
      return toRouteResponse(route);
    } catch (error) {
      if (isPrismaKnownError(error, "P2002")) {
        throw new BadRequestException(
          `El chofer "${driver.name}" ya tiene una ruta planificada para el ${dto.date}`,
        );
      }
      throw error;
    }
  }

  /** Always paginated; a DRIVER's own routes only, regardless of ?driverId. */
  async findAll(query: ListRoutesQueryDto, actor: RouteActor): Promise<PaginatedRoutesDto> {
    const { page, limit } = query;
    const where = buildRouteFilter(query, actor);

    const [total, routes] = await this.prisma.$transaction([
      this.prisma.route.count({ where }),
      this.prisma.route.findMany({
        where,
        include: ROUTE_INCLUDE,
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: routes.map(toRouteResponse),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string, actor: RouteActor): Promise<RouteResponseDto> {
    const route = await this.prisma.route.findUnique({ where: { id }, include: ROUTE_INCLUDE });
    if (route === null) {
      throw new NotFoundException(`La ruta "${id}" no existe`);
    }
    assertCanAccessRoute(actor, route);
    return toRouteResponse(route);
  }

  /**
   * PLANNED -> IN_PROGRESS, and nothing else. The status guard lives in the
   * WHERE clause of the update itself (same idiom as OrdersService.cancel):
   * a check-then-update could be overtaken by a concurrent call, and would
   * start a route twice.
   */
  async start(id: string, actor: RouteActor): Promise<RouteResponseDto> {
    const route = await this.getOwnedRouteOrThrow(id, actor);

    const { count } = await this.prisma.route.updateMany({
      where: { id, status: RouteStatus.PLANNED },
      data: { status: RouteStatus.IN_PROGRESS },
    });
    if (count === 0) {
      throw new ConflictException(
        `Solo se puede iniciar una ruta planificada; esta está en ${route.status}`,
      );
    }
    return this.findOne(id, actor);
  }

  /** IN_PROGRESS -> FINISHED, and nothing else. Same idiom as start(). */
  async finish(id: string, actor: RouteActor): Promise<RouteResponseDto> {
    const route = await this.getOwnedRouteOrThrow(id, actor);

    const { count } = await this.prisma.route.updateMany({
      where: { id, status: RouteStatus.IN_PROGRESS },
      data: { status: RouteStatus.FINISHED },
    });
    if (count === 0) {
      throw new ConflictException(
        `Solo se puede terminar una ruta en curso; esta está en ${route.status}`,
      );
    }
    return this.findOne(id, actor);
  }

  /**
   * `position` is assigned here (never accepted from the caller): the next
   * free slot, contiguous from 1. Origin drives which of orderId/locationId
   * is required — ORDER derives its location from the order itself (a stop
   * never disagrees with the order about where it's going); VAN_SALE takes
   * a location directly and never touches an order.
   *
   * `route_stops_order_id_key` is what actually guarantees an order is never
   * double-booked under concurrent adds; the upfront read below exists only
   * to name the problem instead of surfacing a raw constraint violation.
   */
  async addStop(
    routeId: string,
    dto: CreateRouteStopDto,
    actor: RouteActor,
  ): Promise<RouteStopResponseDto> {
    const route = await this.getOwnedRouteOrThrow(routeId, actor);
    assertRouteIsTouchable(route.status, "agregar paradas");

    let locationId: string;
    let orderId: string | null;

    if (dto.origin === StopOrigin.ORDER) {
      if (dto.orderId === undefined) {
        throw new BadRequestException("Falta orderId para una parada de origen ORDER");
      }
      if (dto.locationId !== undefined) {
        throw new BadRequestException(
          "Una parada de origen ORDER no lleva locationId; se toma del pedido",
        );
      }
      const order = await this.prisma.order.findUnique({
        where: { id: dto.orderId },
        select: { id: true, status: true, locationId: true, routeStop: { select: { id: true } } },
      });
      if (order === null) {
        throw new BadRequestException(`El pedido "${dto.orderId}" no existe`);
      }
      if (order.status !== OrderStatus.PENDING) {
        throw new BadRequestException(`El pedido "${dto.orderId}" no está pendiente`);
      }
      if (order.routeStop !== null) {
        throw new BadRequestException(`El pedido "${dto.orderId}" ya está asignado a otra parada`);
      }
      locationId = order.locationId;
      orderId = dto.orderId;
    } else {
      if (dto.locationId === undefined) {
        throw new BadRequestException("Falta locationId para una parada de origen VAN_SALE");
      }
      if (dto.orderId !== undefined) {
        throw new BadRequestException("Una parada de origen VAN_SALE no lleva orderId");
      }
      const location = await this.prisma.customerLocation.findUnique({
        where: { id: dto.locationId },
        select: { id: true },
      });
      if (location === null) {
        throw new BadRequestException(`La locación "${dto.locationId}" no existe`);
      }
      locationId = dto.locationId;
      orderId = null;
    }

    try {
      const stop = await this.prisma.$transaction(async (tx) => {
        const last = await tx.routeStop.findFirst({
          where: { routeId },
          orderBy: { position: "desc" },
          select: { position: true },
        });
        return tx.routeStop.create({
          data: {
            routeId,
            locationId,
            origin: dto.origin,
            orderId,
            position: (last?.position ?? 0) + 1,
            addedById: actor.id,
          },
          include: STOP_INCLUDE,
        });
      });
      return toStopResponse(stop);
    } catch (error) {
      if (isPrismaKnownError(error, "P2002")) {
        throw new BadRequestException(`El pedido "${dto.orderId}" ya está asignado a otra parada`);
      }
      throw error;
    }
  }

  /**
   * DELIVERED or FAILED, and nothing else — never back to PENDING. Only
   * while the route is IN_PROGRESS: marking before the route starts or
   * after it finished has no real-world counterpart. This endpoint changes
   * only the stop's own status; it creates no sale and no container
   * movement — that is the dispatch PR's job.
   */
  async markStop(
    routeId: string,
    stopId: string,
    dto: MarkRouteStopDto,
    actor: RouteActor,
  ): Promise<RouteStopResponseDto> {
    const route = await this.getOwnedRouteOrThrow(routeId, actor);
    if (route.status !== RouteStatus.IN_PROGRESS) {
      throw new ConflictException(
        `Solo se pueden marcar paradas de una ruta en curso; esta está en ${route.status}`,
      );
    }

    if (dto.status === StopStatus.FAILED && (dto.failureReason ?? "").trim().length === 0) {
      throw new BadRequestException("Una parada fallida necesita un motivo");
    }
    if (dto.status === StopStatus.DELIVERED && dto.failureReason !== undefined) {
      throw new BadRequestException("Una parada entregada no lleva motivo de falla");
    }

    const { count } = await this.prisma.routeStop.updateMany({
      where: { id: stopId, routeId, status: StopStatus.PENDING },
      data: {
        status: dto.status,
        failureReason: dto.status === StopStatus.FAILED ? (dto.failureReason ?? null) : null,
      },
    });

    if (count === 0) {
      const existing = await this.prisma.routeStop.findFirst({
        where: { id: stopId, routeId },
        select: { status: true },
      });
      if (existing === null) {
        throw new NotFoundException(`La parada "${stopId}" no existe en esta ruta`);
      }
      throw new ConflictException(`Esta parada ya está en estado ${existing.status}`);
    }

    const stop = await this.prisma.routeStop.findUniqueOrThrow({
      where: { id: stopId },
      include: STOP_INCLUDE,
    });
    return toStopResponse(stop);
  }

  /**
   * Takes the FULL new order, not a partial patch: rejects a list that
   * omits a stop, repeats one, or names one from another route, so a
   * partial/stale client payload can never leave a gap or a duplicate
   * position behind.
   */
  async reorderStops(
    routeId: string,
    dto: ReorderRouteStopsDto,
    actor: RouteActor,
  ): Promise<RouteResponseDto> {
    const route = await this.getOwnedRouteOrThrow(routeId, actor);
    assertRouteIsTouchable(route.status, "reordenar paradas");

    const existing = await this.prisma.routeStop.findMany({
      where: { routeId },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((stop) => stop.id));
    const requestedIds = dto.stopIds;
    const requestedSet = new Set(requestedIds);

    if (requestedSet.size !== requestedIds.length) {
      throw new BadRequestException("La lista de paradas no puede repetir un id");
    }
    if (requestedIds.length !== existingIds.size) {
      throw new BadRequestException(
        `La lista debe incluir las ${existingIds.size} paradas de la ruta, ni más ni menos`,
      );
    }
    const foreign = requestedIds.filter((id) => !existingIds.has(id));
    if (foreign.length > 0) {
      throw new BadRequestException(
        `Estas paradas no pertenecen a la ruta "${routeId}": ${foreign.join(", ")}`,
      );
    }

    await this.prisma.$transaction(
      requestedIds.map((stopId, index) =>
        this.prisma.routeStop.update({ where: { id: stopId }, data: { position: index + 1 } }),
      ),
    );

    return this.findOne(routeId, actor);
  }

  private async getOwnedRouteOrThrow(
    id: string,
    actor: RouteActor,
  ): Promise<{ id: string; driverId: string; status: RouteStatus }> {
    const route = await this.prisma.route.findUnique({
      where: { id },
      select: { id: true, driverId: true, status: true },
    });
    if (route === null) {
      throw new NotFoundException(`La ruta "${id}" no existe`);
    }
    assertCanAccessRoute(actor, route);
    return route;
  }
}

/** PLANNED and IN_PROGRESS may still be edited; FINISHED never is. */
function assertRouteIsTouchable(status: RouteStatus, action: string): void {
  if (status !== RouteStatus.PLANNED && status !== RouteStatus.IN_PROGRESS) {
    throw new ConflictException(`No se pueden ${action} de una ruta en estado ${status}`);
  }
}

function buildRouteFilter(query: ListRoutesQueryDto, actor: RouteActor): Prisma.RouteWhereInput {
  const { date, driverId, zoneId, status } = query;
  const effectiveDriverId = isPrivileged(actor) ? driverId : actor.id;

  return {
    ...(date !== undefined ? { date: parseBusinessDate(date, "La fecha") } : {}),
    ...(effectiveDriverId !== undefined ? { driverId: effectiveDriverId } : {}),
    ...(zoneId !== undefined ? { zoneId } : {}),
    ...(status !== undefined ? { status } : {}),
  };
}
