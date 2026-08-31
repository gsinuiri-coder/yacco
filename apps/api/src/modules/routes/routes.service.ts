import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  ContainerMovementType,
  ContainerState,
  OrderStatus,
  Prisma,
  RouteStatus,
  StopOrigin,
  StopStatus,
  UserRole,
} from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service.js";
import { ContainerMovementsService } from "../container-movements/container-movements.service.js";
import { formatBusinessDate, parseBusinessDate } from "../orders/orders.service.js";
import type { RegisterStopDeliveryResult } from "../sales/sales.service.js";
import { SalesService } from "../sales/sales.service.js";
import type { CorrectRouteStopDto } from "./dto/correct-route-stop.dto.js";
import type { CreateRouteLoadDto } from "./dto/create-route-load.dto.js";
import type { CreateRouteDto } from "./dto/create-route.dto.js";
import type { CreateRouteStopDto } from "./dto/create-route-stop.dto.js";
import type { FindRouteQueryDto } from "./dto/find-route-query.dto.js";
import type { ListRoutesQueryDto } from "./dto/list-routes-query.dto.js";
import type { MarkRouteStopDto } from "./dto/mark-route-stop.dto.js";
import type { ReorderRouteStopsDto } from "./dto/reorder-route-stops.dto.js";
import type { RouteLoadResponseDto } from "./dto/route-load-response.dto.js";
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

const BUSINESS_DATE_TEXT = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * "2026-08-28" -> "28/08/2026", para un mensaje que va a leer una persona.
 * Toda la UI muestra las fechas de negocio así; un error que devuelve el
 * formato del cable la hace hablar en dos idiomas en la misma pantalla, y la
 * web muestra el mensaje del backend tal cual a propósito —para que no se
 * despegue del que mantiene la API—, así que el formato tiene que salir bien
 * de acá.
 *
 * Parte el texto en vez de pasar por `Date`, igual que `lib/business-date.ts`
 * en la web y por la misma razón: `new Date("2026-08-28")` es medianoche UTC
 * y en America/Lima (UTC-5) se lee un día antes. Si el valor no tiene la
 * forma esperada se devuelve tal cual, que es preferible a inventar una fecha
 * dentro de un mensaje de error.
 *
 * Vive acá y no en un módulo común porque este es el ÚNICO mensaje de toda
 * la API que interpola una fecha de negocio: los demás hablan de fechas sin
 * nombrar ninguna ("La fecha desde no puede ser posterior a la fecha hasta").
 * El día que aparezca el segundo, se muda.
 */
function formatBusinessDateForMessage(businessDate: string): string {
  const match = BUSINESS_DATE_TEXT.exec(businessDate);
  if (match === null) return businessDate;
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

// `customer` viaja con la locación, no aparte: una parada nombra un lugar,
// y el lugar es de alguien. Sin el cliente, toda parada se muestra como
// "Principal" (el nombre de la locación principal de cualquier cliente).
const STOP_INCLUDE = {
  location: {
    select: {
      id: true,
      name: true,
      address: true,
      customer: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.RouteStopInclude;

const ROUTE_INCLUDE = {
  driver: { select: { id: true, name: true } },
  zone: { select: { id: true, name: true } },
  stops: { include: STOP_INCLUDE, orderBy: { position: "asc" } },
} satisfies Prisma.RouteInclude;

const LOAD_INCLUDE = {
  batchItem: {
    select: {
      id: true,
      containerTypeId: true,
      containerType: { select: { id: true, name: true } },
      batchId: true,
      batch: { select: { id: true, code: true } },
    },
  },
} satisfies Prisma.RouteLoadInclude;

type RouteWithRelations = Prisma.RouteGetPayload<{ include: typeof ROUTE_INCLUDE }>;
type StopWithRelations = Prisma.RouteStopGetPayload<{ include: typeof STOP_INCLUDE }>;
type LoadWithRelations = Prisma.RouteLoadGetPayload<{ include: typeof LOAD_INCLUDE }>;

function toStopResponse(
  stop: StopWithRelations,
  delivery?: RegisterStopDeliveryResult,
): RouteStopResponseDto {
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
    ...(delivery !== undefined
      ? {
          sale: delivery.sale,
          payment: delivery.payment,
          containerBalances: delivery.containerBalances,
          stockShortfall: delivery.stockShortfall,
        }
      : {}),
  };
}

function toLoadResponse(load: LoadWithRelations): RouteLoadResponseDto {
  return {
    id: load.id,
    routeId: load.routeId,
    batchItemId: load.batchItemId,
    batchItem: load.batchItem,
    quantity: load.quantity,
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
    stops: route.stops.map((stop) => toStopResponse(stop)),
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly containerMovementsService: ContainerMovementsService,
    private readonly salesService: SalesService,
  ) {}

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
          `El chofer "${driver.name}" ya tiene una ruta planificada para el ${formatBusinessDateForMessage(dto.date)}`,
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

  /**
   * `stopStatus` filters the returned `stops` array in memory rather than in
   * the query (`ROUTE_INCLUDE.stops` has no `where`): with the idempotency
   * guard on markStop making PENDING stops the office's actual work list,
   * this is what lets `?stopStatus=PENDING` show only what's left to
   * resolve, without a second endpoint or a second include shape.
   */
  async findOne(
    id: string,
    actor: RouteActor,
    query?: FindRouteQueryDto,
  ): Promise<RouteResponseDto> {
    const route = await this.prisma.route.findUnique({ where: { id }, include: ROUTE_INCLUDE });
    if (route === null) {
      throw new NotFoundException(`La ruta "${id}" no existe`);
    }
    assertCanAccessRoute(actor, route);
    if (query?.stopStatus === undefined) {
      return toRouteResponse(route);
    }
    return toRouteResponse({
      ...route,
      stops: route.stops.filter((stop) => stop.status === query.stopStatus),
    });
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

  /**
   * IN_PROGRESS -> FINISHED, y solo con TODAS sus paradas resueltas. Same
   * idiom as start(): las dos condiciones viven en el WHERE del update, no en
   * una lectura previa que una llamada concurrente pueda adelantar.
   *
   * Bloquear acá NO contradice el «avisa, no bloquea» del sistema —el límite
   * de crédito advierte, una liquidación descuadrada cierra igual—: esa
   * filosofía es para juicios de negocio, donde el dato incómodo se registra
   * en vez de suprimirse. Esto es la máquina de estados. Una parada que queda
   * PENDING cuando la ruta pasa a FINISHED deja su pedido en ON_ROUTE sin
   * ninguna salida: `markStop` exige la ruta IN_PROGRESS, `removeStop` exige
   * que se pueda tocar, `OrdersService.cancel` exige el pedido PENDING, y
   * nada devuelve una ruta a IN_PROGRESS. No es un aviso que el dueño pueda
   * ignorar: es un pedido congelado para siempre.
   *
   * Dos cosas que quedan así a propósito:
   *
   * - **Una ruta sin paradas se puede terminar.** `none` es cierto sobre el
   *   conjunto vacío, y una ruta que nunca tuvo paradas no congela ningún
   *   pedido.
   * - **La carrera del subquery no se cierra acá.** El filtro de relación no
   *   bloquea las filas de `route_stops`, así que un `addStop` que confirme
   *   dentro de la ventana puede dejar una ruta FINISHED con una parada
   *   PENDING. Es la misma clase que ya tiene `addStop`, cuya lectura de «ruta
   *   tocable» también vive fuera de su transacción. Anotada en el backlog.
   */
  async finish(id: string, actor: RouteActor): Promise<RouteResponseDto> {
    await this.getOwnedRouteOrThrow(id, actor);

    const { count } = await this.prisma.route.updateMany({
      where: {
        id,
        status: RouteStatus.IN_PROGRESS,
        stops: { none: { status: StopStatus.PENDING } },
      },
      data: { status: RouteStatus.FINISHED },
    });
    if (count === 0) {
      await this.throwCannotFinishConflict(id);
    }
    return this.findOne(id, actor);
  }

  /**
   * `count === 0` tiene ahora dos causas —la ruta no está en curso, o le
   * quedan paradas sin resolver— y el mensaje tiene que nombrar la verdadera.
   * Se releen las dos acá en vez de deducirlas de la lectura previa, por la
   * misma razón que `throwAlreadyMarkedConflict` relee la parada: entre
   * aquella lectura y el UPDATE pudo pasar cualquier cosa, y quien lee el
   * error necesita saber qué es la ruta ahora.
   */
  private async throwCannotFinishConflict(id: string): Promise<never> {
    const [route, pendingStops] = await this.prisma.$transaction([
      this.prisma.route.findUnique({ where: { id }, select: { status: true } }),
      this.prisma.routeStop.count({ where: { routeId: id, status: StopStatus.PENDING } }),
    ]);
    if (route === null) {
      throw new NotFoundException(`La ruta "${id}" no existe`);
    }
    if (route.status !== RouteStatus.IN_PROGRESS) {
      throw new ConflictException(
        `Solo se puede terminar una ruta en curso; esta está en ${route.status}`,
      );
    }
    throw new ConflictException(unresolvedStopsMessage(pendingStops));
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
      // "Ya asignado" se pregunta ANTES que "no está pendiente", y el orden
      // importa desde que el pedido sigue a su parada: un pedido con parada
      // está además en ON_ROUTE, así que preguntar por el estado primero
      // taparía la causa específica con una genérica. Las dos son ciertas; la
      // que le sirve a quien la lee es la que nombra la otra parada.
      if (order.routeStop !== null) {
        throw new BadRequestException(`El pedido "${dto.orderId}" ya está asignado a otra parada`);
      }
      if (order.status !== OrderStatus.PENDING) {
        throw new BadRequestException(`El pedido "${dto.orderId}" no está pendiente`);
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
        throw new BadRequestException(`La ubicación "${dto.locationId}" no existe`);
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
        const created = await tx.routeStop.create({
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

        // HU-10 E1: el pedido pasa a ON_ROUTE en el momento de la asignación,
        // no al iniciar la ruta. Escribirlo en `start()` dejaría una ventana en
        // la que un pedido ya planificado se puede cancelar mientras el chofer
        // lo lleva en la hoja de ruta.
        //
        // Va en ESTA transacción: si la escritura del pedido falla, la parada
        // no queda creada. Y el `status: PENDING` del WHERE no es decorativo —
        // la lectura de más arriba ocurrió fuera de la transacción, así que
        // esta es la única comprobación que no puede ser adelantada por una
        // cancelación concurrente. Solo las paradas ORDER tienen `orderId`;
        // una de VAN_SALE no toca ningún pedido.
        if (orderId !== null) {
          const { count } = await tx.order.updateMany({
            where: { id: orderId, status: OrderStatus.PENDING },
            data: { status: OrderStatus.ON_ROUTE },
          });
          if (count === 0) {
            throw new BadRequestException(`El pedido "${orderId}" no está pendiente`);
          }
        }

        return created;
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
   * Quita una parada que todavía no se resolvió. Solo PENDING, y solo
   * mientras la ruta se puede tocar: una parada DELIVERED tiene una venta,
   * movimientos de envases y quizá un cobro colgando de ella, y borrarla
   * sería editar el libro — que es exactamente lo que el dominio prohíbe (un
   * error de campo se corrige con movimientos inversos, nunca borrando lo
   * sincronizado).
   *
   * `route_stops` no es un ledger: una parada pendiente no dejó ningún
   * registro contable detrás, así que la fila se borra de verdad en vez de
   * marcarse. Quitar una parada de origen ORDER libera el pedido
   * (`route_stops_order_id_key`), que vuelve a estar disponible para otra
   * ruta — es justo lo que la oficina quiere al sacar un pedido del camión.
   *
   * Las posiciones se recompactan en la misma transacción para que sigan
   * siendo 1..N contiguas, la misma garantía que mantiene `addStop`; sin eso
   * un hueco haría que la siguiente parada agregada reutilizara una posición
   * ya usada.
   */
  async removeStop(routeId: string, stopId: string, actor: RouteActor): Promise<void> {
    const route = await this.getOwnedRouteOrThrow(routeId, actor);
    assertRouteIsTouchable(route.status, "quitar paradas");

    const stop = await this.prisma.routeStop.findFirst({
      where: { id: stopId, routeId },
      select: { id: true, status: true, position: true, orderId: true },
    });
    if (stop === null) {
      throw new NotFoundException(`La parada "${stopId}" no existe en esta ruta`);
    }
    if (stop.status !== StopStatus.PENDING) {
      throw new ConflictException(
        `Solo se puede quitar una parada pendiente; esta está en ${stop.status}`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.routeStop.delete({ where: { id: stopId } });
      await tx.routeStop.updateMany({
        where: { routeId, position: { gt: stop.position } },
        data: { position: { decrement: 1 } },
      });

      // Devolver el pedido a PENDING no es opcional: `addStop` exige
      // PENDING, así que sin esto "liberar el pedido" —lo que el docblock de
      // arriba promete— dejaría un pedido que ninguna ruta puede volver a
      // tomar. En la misma transacción que el borrado, o la parada
      // desaparece y el pedido queda ON_ROUTE sin parada.
      if (stop.orderId !== null) {
        await tx.order.update({
          where: { id: stop.orderId },
          data: { status: OrderStatus.PENDING },
        });
      }
    });
  }

  /**
   * DELIVERED or FAILED, and nothing else — never back to PENDING. Only
   * while the route is IN_PROGRESS: marking before the route starts or
   * after it finished has no real-world counterpart.
   *
   * Las dos son transacciones, y las dos mueven el pedido de la parada si lo
   * hay. FAILED es la más chica —el flip más el estado del pedido—; DELIVERED
   * además registra la entrega entera (venta, movimientos de envases, cobro)
   * en esa misma transacción — see `markStopDelivered` and
   * `SalesService.registerStopDeliveryWithinTransaction`.
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

    assertMarkPayloadMatchesStatus(dto);
    if (dto.status === StopStatus.FAILED) {
      return this.markStopFailed(routeId, stopId, dto.failureReason as string);
    }
    return this.markStopDelivered(routeId, stopId, dto, actor);
  }

  /**
   * Pasó a ser transacción cuando el pedido empezó a seguir a su parada: el
   * flip de la parada y el estado del pedido tienen que confirmarse o
   * deshacerse juntos, igual que en `markStopDelivered`. Antes era un
   * `updateMany` suelto porque no había nada más que escribir.
   *
   * El pedido queda en FAILED y NUNCA vuelve a PENDING. `Order.deliveryDate`
   * es una fecha de negocio: reintentar mañana es otro día de entrega y se
   * registra como un pedido nuevo. Devolverlo a PENDING haría que un pedido
   * fallado tres veces se viera idéntico a uno recién tomado.
   */
  private async markStopFailed(
    routeId: string,
    stopId: string,
    failureReason: string,
  ): Promise<RouteStopResponseDto> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.routeStop.updateMany({
        where: { id: stopId, routeId, status: StopStatus.PENDING },
        data: { status: StopStatus.FAILED, failureReason },
      });
      if (count === 0) {
        await this.throwAlreadyMarkedConflict(tx, routeId, stopId);
      }

      const stop = await tx.routeStop.findUniqueOrThrow({
        where: { id: stopId },
        include: STOP_INCLUDE,
      });

      // El flip de arriba, guardado por `status: PENDING`, es lo que serializa
      // dos marcas concurrentes de la misma parada: exactamente un UPDATE toca
      // la fila, así que acá el pedido se escribe sin más guarda.
      if (stop.orderId !== null) {
        await tx.order.update({
          where: { id: stop.orderId },
          data: { status: OrderStatus.FAILED },
        });
      }

      return toStopResponse(stop);
    });
  }

  /**
   * The RouteStop status flip and the whole delivery (Sale/SaleItems,
   * container movements both ways, the Payment if any) commit or roll back
   * together, in this one transaction. The flip is a plain UPDATE guarded by
   * `WHERE status = 'PENDING'`, never a prior read-then-write: under two
   * concurrent requests for the same stop, Postgres serializes them on that
   * row, exactly one UPDATE affects a row, and the loser's `count === 0`
   * aborts the transaction before SalesService writes anything — leaving no
   * sale, no movement and no payment behind.
   */
  private async markStopDelivered(
    routeId: string,
    stopId: string,
    dto: MarkRouteStopDto,
    actor: RouteActor,
  ): Promise<RouteStopResponseDto> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.routeStop.updateMany({
        where: { id: stopId, routeId, status: StopStatus.PENDING },
        data: { status: StopStatus.DELIVERED },
      });
      if (count === 0) {
        await this.throwAlreadyMarkedConflict(tx, routeId, stopId);
      }

      const stop = await tx.routeStop.findUniqueOrThrow({
        where: { id: stopId },
        include: STOP_INCLUDE,
      });

      // El pedido sigue a su parada, en esta misma transacción: si la venta o
      // los movimientos de envase fallan más abajo, el pedido tampoco queda
      // entregado. Una parada de VAN_SALE no tiene pedido que mover.
      if (stop.orderId !== null) {
        await tx.order.update({
          where: { id: stop.orderId },
          data: { status: OrderStatus.DELIVERED },
        });
      }

      const delivery = await this.salesService.registerStopDeliveryWithinTransaction(tx, {
        routeId,
        stopId,
        locationId: stop.locationId,
        items: dto.items ?? [],
        containersReturned: dto.containersReturned ?? [],
        recordedById: actor.id,
        // Explícito, no por defecto: registrar una parada es anotar lo que
        // acaba de pasar, así que el instante es ahora. Es el otro llamador
        // —`correctStop`— el que hereda el instante de la entrega original.
        occurredAt: new Date(),
        ...(dto.payment !== undefined ? { payment: dto.payment } : {}),
        ...(dto.priceOverrideAuthorizedById !== undefined
          ? { priceOverrideAuthorizedById: dto.priceOverrideAuthorizedById }
          : {}),
      });

      return toStopResponse(stop, delivery);
    });
  }

  /**
   * Corregir una parada ya marcada: anula lo que se anotó y vuelve a
   * registrarla como realmente fue. No es editar la fila (CLAUDE.md: un error
   * operativo NUNCA se corrige editando ni borrando el registro): la venta
   * anterior queda en la tabla, anulada y con su motivo, y los envases se
   * devuelven con movimientos inversos. Lo único que se pisa son las tres
   * columnas de corrección de la parada, que guardan SOLO LA ÚLTIMA — la
   * historia entera vive en las ventas anuladas y en el libro.
   *
   * Es exclusiva del ADMIN (`@Roles` a nivel de método en el controlador), y
   * por eso `priceOverrideAuthorizedById` de la re-registración es SIEMPRE
   * `actor.id`, difiera o no el precio: la operación ya lleva motivo y ya está
   * restringida, y quien corrige es exactamente quien autoriza. Ojo con el
   * efecto: `hasOverride` se calcula contra el precio VIGENTE HOY, así que una
   * corrección que no toca el precio igual queda marcada como override si el
   * `CustomerPrice` cambió desde la venta original. Es información sobrante,
   * no información falsa —ese ADMIN sí autorizó este registro—, y el precio
   * cobrado queda escrito tal cual en la venta.
   *
   * **El cuerpo describe la parada ENTERA como quedó, no el pedacito que
   * cambia.** Corregir es anular y volver a registrar, así que lo que el
   * cuerpo no diga no se re-registra: mandar solo `items` para arreglar una
   * cantidad borra el cobro y los vacíos que la parada tenía, porque la
   * anulación ya los deshizo y nada los vuelve a escribir. Es reemplazo, no
   * parche, y quien llama tiene que repetir `payment` y `containersReturned`
   * si siguen valiendo.
   *
   * Una ruta SETTLED NO bloquea: la liquidación pasa a estar desactualizada, y
   * mostrarlo es lectura, no escritura. PLANNED sí, porque no hay nada
   * registrado que corregir.
   */
  async correctStop(
    routeId: string,
    stopId: string,
    dto: CorrectRouteStopDto,
    actor: RouteActor,
  ): Promise<RouteStopResponseDto> {
    const route = await this.getOwnedRouteOrThrow(routeId, actor);
    if (route.status === RouteStatus.PLANNED) {
      throw new ConflictException(
        "En una ruta planificada todavía no se registró ninguna parada, así que no hay nada que corregir",
      );
    }
    if (dto.correctionReason.trim().length === 0) {
      throw new BadRequestException("El motivo de la corrección no puede estar vacío");
    }
    // Prohibido en el cuerpo aunque el DTO lo herede: acá lo pone el servicio
    // —el ADMIN que corrige— y aceptarlo dejaría creer que otro usuario puede
    // autorizar el precio de una corrección.
    if (dto.priceOverrideAuthorizedById !== undefined) {
      throw new BadRequestException(
        "En una corrección el precio lo autoriza quien corrige; no se envía priceOverrideAuthorizedById",
      );
    }
    assertMarkPayloadMatchesStatus(dto);

    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.routeStop.updateMany({
        where: { id: stopId, routeId, status: { in: [StopStatus.DELIVERED, StopStatus.FAILED] } },
        data: {
          status: dto.status,
          correctedAt: new Date(),
          correctedById: actor.id,
          correctionReason: dto.correctionReason,
          // Yendo a FAILED se escribe el motivo nuevo. Yendo a DELIVERED el
          // `failureReason` original SE CONSERVA, no se limpia: es lo que el
          // chofer dijo que había pasado, y borrarlo destruiría la evidencia
          // de que hubo un error de anotación. La parada queda DELIVERED con
          // un motivo de falla viejo colgando, que se lee raro pero es cierto.
          // El próximo lector va a querer limpiarlo: no lo hagas.
          ...(dto.status === StopStatus.FAILED
            ? { failureReason: dto.failureReason as string }
            : {}),
        },
      });
      if (count === 0) {
        await this.throwNothingToCorrectConflict(tx, routeId, stopId);
      }

      const stop = await tx.routeStop.findUniqueOrThrow({
        where: { id: stopId },
        include: STOP_INCLUDE,
      });

      // EL ORDEN IMPORTA Y NO ES CASUAL: anular ANTES de volver a registrar.
      //
      // La razón que manda es que `emitStopVoidMovements` netea sobre TODOS
      // los movimientos de este `stopId`: al revés, el LOAN_DELIVERY recién
      // escrito entraría en ese neteo y la anulación revertiría justo la
      // entrega que acababa de registrarse. No es una preferencia de estilo
      // —`allowStockShortfall` no la vuelve opcional—, es la diferencia entre
      // corregir y dejar la parada sin nada.
      //
      // La segunda razón es el stock: los LOAN_DELIVERY_VOID y FULL_SALE_VOID
      // entran a FULL_ON_ROUTE y `getRouteFullStock` agrega por ESTADO, así
      // que la anulación devuelve los llenos al camión justo antes de que la
      // re-registración se los pida. Al revés, corregir la misma cantidad
      // sobre un camión que quedó vacío contaría un faltante que no existe.
      //
      // No-op silencioso si la parada estaba FAILED y no había venta.
      const voided = await this.salesService.voidStopDeliveryWithinTransaction(tx, {
        stopId,
        voidedById: actor.id,
        voidReason: dto.correctionReason,
      });

      // El pedido sigue a su parada, igual que al marcarla, y nunca vuelve a
      // PENDING: una corrección no deshace que el pedido salió en un camión.
      if (stop.orderId !== null) {
        await tx.order.update({
          where: { id: stop.orderId },
          data: {
            status:
              dto.status === StopStatus.DELIVERED ? OrderStatus.DELIVERED : OrderStatus.FAILED,
          },
        });
      }

      if (dto.status !== StopStatus.DELIVERED) {
        return toStopResponse(stop);
      }

      // La entrega corregida es la MISMA entrega, del mismo día: hereda el
      // `soldAt` de la venta que se acaba de anular. Si la parada estaba
      // FAILED no hay ninguna, y el instante sale del día de la ruta, al
      // mediodía de Lima — la hora de reparto, y la que menos se corre al
      // cruzar el borde del día en cualquier lectura por fecha de negocio.
      const occurredAt = voided.sale?.soldAt ?? limaNoonOfBusinessDate(route.date, new Date());

      const delivery = await this.salesService.registerStopDeliveryWithinTransaction(tx, {
        routeId,
        stopId,
        locationId: stop.locationId,
        items: dto.items ?? [],
        containersReturned: dto.containersReturned ?? [],
        recordedById: actor.id,
        occurredAt,
        priceOverrideAuthorizedById: actor.id,
        allowStockShortfall: true,
        ...(dto.payment !== undefined ? { payment: dto.payment } : {}),
      });

      return toStopResponse(stop, delivery);
    });
  }

  /**
   * El 409 de "no hay nada que corregir". No reusa `throwAlreadyMarkedConflict`
   * a propósito: ese mensaje habla de una entrega YA registrada para frenar un
   * doble cobro, que es exactamente lo contrario de lo que pasa acá. Corregir
   * falla cuando la parada nunca se marcó —sigue PENDING, y entonces se marca,
   * no se corrige— o cuando no existe en esta ruta.
   */
  private async throwNothingToCorrectConflict(
    client: Prisma.TransactionClient,
    routeId: string,
    stopId: string,
  ): Promise<never> {
    const existing = await client.routeStop.findFirst({
      where: { id: stopId, routeId },
      select: { status: true },
    });
    if (existing === null) {
      throw new NotFoundException(`La parada "${stopId}" no existe en esta ruta`);
    }
    throw new ConflictException(
      "Esta parada todavía no se registró, así que no hay nada que corregir: primero hay que marcarla como entregada o no entregada",
    );
  }

  /**
   * Names what actually happened, per CLAUDE.md: naming the date and who
   * recorded it is what stops the office and a driver from double-charging
   * the same delivery. `soldAt` is a timestamptz (an instant, not a business
   * date — CLAUDE.md's date-formatting rule doesn't apply here), so a plain
   * ISO string is enough for a message nobody parses back.
   *
   * `voidedAt: null` en la búsqueda de la venta: una parada corregida deja su
   * venta anulada en la tabla, y sin ese filtro este mensaje citaría la fecha
   * y el nombre de una entrega que ya no vale — "ya fue registrada el ... por
   * ..." apuntando a algo que se deshizo, que es peor que no decir nada. Sin
   * venta vigente cae al mensaje genérico de estado, que es lo correcto.
   */
  private async throwAlreadyMarkedConflict(
    client: Prisma.TransactionClient | PrismaService,
    routeId: string,
    stopId: string,
  ): Promise<never> {
    const existing = await client.routeStop.findFirst({
      where: { id: stopId, routeId },
      select: { status: true },
    });
    if (existing === null) {
      throw new NotFoundException(`La parada "${stopId}" no existe en esta ruta`);
    }
    if (existing.status === StopStatus.DELIVERED) {
      const sale = await client.sale.findFirst({
        where: { stopId, voidedAt: null },
        select: { soldAt: true, recordedBy: { select: { name: true } } },
      });
      if (sale !== null) {
        throw new ConflictException(
          `Esta entrega ya fue registrada el ${sale.soldAt.toISOString()} por ${sale.recordedBy.name}`,
        );
      }
    }
    throw new ConflictException(`Esta parada ya está en estado ${existing.status}`);
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

  /**
   * Registers one ContainerMovement (ROUTE_LOAD, FULL_AT_PLANT ->
   * FULL_ON_ROUTE) through ContainerMovementsService — never a hand-written
   * insert — in the SAME transaction as the RouteLoad row and the
   * availableQty decrement. The decrement is a single UPDATE guarded by
   * `WHERE available_qty >= quantity`, never a read-then-write: two trucks
   * loading the same batchItem at once must have exactly one of them win,
   * not both succeed against stock that only covers one.
   *
   * El `batchItemId` que llega tiene que ser el del lote más antiguo con
   * unidades de ese tipo de envase: ver `assertIsOldestBatchItemWithStock`.
   *
   * Loading the same batchItem twice on one route inserts a NEW RouteLoad
   * row rather than incrementing an existing one ("suma, no reemplaza" is
   * satisfied by summing the rows, not by a running total column): each
   * POST is exactly one RouteLoad row paired with exactly one
   * ContainerMovement, so DELETE /routes/:id/loads/:loadId always has one
   * unambiguous row — and one movement — to reverse. An incrementing design
   * would leave DELETE with no single movement to point the reversal at
   * once two loads had merged into one row.
   */
  async addLoad(
    routeId: string,
    dto: CreateRouteLoadDto,
    actor: RouteActor,
  ): Promise<RouteLoadResponseDto> {
    const route = await this.getOwnedRouteOrThrow(routeId, actor);
    assertRouteIsTouchable(route.status, "cargar unidades");

    const batchItem = await this.prisma.batchItem.findUnique({
      where: { id: dto.batchItemId },
      select: { id: true, batchId: true, containerTypeId: true },
    });
    if (batchItem === null) {
      throw new BadRequestException(`El ítem de lote "${dto.batchItemId}" no existe`);
    }

    const load = await this.prisma.$transaction(async (tx) => {
      await assertIsOldestBatchItemWithStock(tx, batchItem);

      const { count } = await tx.batchItem.updateMany({
        where: { id: dto.batchItemId, availableQty: { gte: dto.quantity } },
        data: { availableQty: { decrement: dto.quantity } },
      });
      if (count === 0) {
        throw new BadRequestException(
          `Stock insuficiente en el ítem de lote "${dto.batchItemId}" para cargar ${dto.quantity} unidades`,
        );
      }

      await this.containerMovementsService.createWithinTransaction(
        tx,
        {
          type: ContainerMovementType.ROUTE_LOAD,
          containerTypeId: batchItem.containerTypeId,
          quantity: dto.quantity,
          fromState: ContainerState.FULL_AT_PLANT,
          toState: ContainerState.FULL_ON_ROUTE,
        },
        actor.id,
        { batchId: batchItem.batchId, routeId },
      );

      return tx.routeLoad.create({
        data: { routeId, batchItemId: dto.batchItemId, quantity: dto.quantity },
        include: LOAD_INCLUDE,
      });
    });

    return toLoadResponse(load);
  }

  async listLoads(routeId: string, actor: RouteActor): Promise<RouteLoadResponseDto[]> {
    await this.getOwnedRouteOrThrow(routeId, actor);
    const loads = await this.prisma.routeLoad.findMany({
      where: { routeId },
      include: LOAD_INCLUDE,
    });
    return loads.map(toLoadResponse);
  }

  /**
   * Only while the route is still PLANNED: once the truck is out
   * (IN_PROGRESS) or the route is done (FINISHED), a loading mistake is
   * corrected at settlement, not erased here (CLAUDE.md — a settlement
   * mismatch still closes, recording the difference). `route_loads` is not
   * the ledger, so the row is genuinely deleted; `container_movements` is,
   * so the correction appends a FULL_RETURN (FULL_ON_ROUTE ->
   * FULL_AT_PLANT) undoing the original ROUTE_LOAD rather than touching it.
   */
  async removeLoad(routeId: string, loadId: string, actor: RouteActor): Promise<void> {
    const route = await this.getOwnedRouteOrThrow(routeId, actor);
    if (route.status !== RouteStatus.PLANNED) {
      throw new ConflictException(
        `Solo se puede corregir una carga mientras la ruta está planificada; esta está en ${route.status}`,
      );
    }

    const load = await this.prisma.routeLoad.findFirst({
      where: { id: loadId, routeId },
      select: {
        id: true,
        batchItemId: true,
        quantity: true,
        batchItem: { select: { containerTypeId: true, batchId: true } },
      },
    });
    if (load === null) {
      throw new NotFoundException(`La carga "${loadId}" no existe en esta ruta`);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.batchItem.update({
        where: { id: load.batchItemId },
        data: { availableQty: { increment: load.quantity } },
      });

      await this.containerMovementsService.createWithinTransaction(
        tx,
        {
          type: ContainerMovementType.FULL_RETURN,
          containerTypeId: load.batchItem.containerTypeId,
          quantity: load.quantity,
          fromState: ContainerState.FULL_ON_ROUTE,
          toState: ContainerState.FULL_AT_PLANT,
        },
        actor.id,
        { batchId: load.batchItem.batchId, routeId },
      );

      await tx.routeLoad.delete({ where: { id: loadId } });
    });
  }

  private async getOwnedRouteOrThrow(
    id: string,
    actor: RouteActor,
  ): Promise<{ id: string; driverId: string; status: RouteStatus; date: Date }> {
    const route = await this.prisma.route.findUnique({
      where: { id },
      // `date` lo usa `correctStop` para fechar la venta de una parada que
      // estaba FAILED y no tiene ninguna venta de la cual heredar el instante.
      select: { id: true, driverId: true, status: true, date: true },
    });
    if (route === null) {
      throw new NotFoundException(`La ruta "${id}" no existe`);
    }
    assertCanAccessRoute(actor, route);
    return route;
  }
}

/**
 * FIFO estricto: la carga de una ruta consume el lote más antiguo que
 * todavía tenga unidades de ese tipo de envase (CLAUDE.md, invariante de
 * dominio). Hasta acá la regla la sostenía únicamente el reparto que hace la
 * web (`apps/web/src/lib/fifo-load-plan.ts`): cualquier otro cliente —el
 * móvil, un script, Swagger— podía mandar el batchItem que quisiera y el
 * servidor lo aceptaba. Una invariante que solo vive en un cliente no es una
 * invariante.
 *
 * El orden es el mismo que devuelve `GET /production-batches`
 * (`[{ date: "asc" }, { code: "asc" }]`): fecha del lote, y el código como
 * desempate cuando dos lotes son del mismo día. `code` es único, así que el
 * "más antiguo" nunca es ambiguo.
 *
 * La comprobación va DENTRO de la transacción de `addLoad` y con su mismo
 * cliente: leerla afuera dejaría una ventana en la que otra carga agota el
 * lote viejo y el que acá parecía correcto deja de serlo.
 *
 * `oldest === null` significa que ningún lote de ese tipo tiene unidades —
 * incluido el pedido. No es un error de orden sino de stock, así que se deja
 * pasar para que lo reporte el UPDATE guardado de abajo con su mensaje.
 */
async function assertIsOldestBatchItemWithStock(
  tx: Prisma.TransactionClient,
  batchItem: { id: string; containerTypeId: string },
): Promise<void> {
  const oldest = await tx.batchItem.findFirst({
    where: { containerTypeId: batchItem.containerTypeId, availableQty: { gt: 0 } },
    orderBy: [{ batch: { date: "asc" } }, { batch: { code: "asc" } }],
    select: { id: true, batch: { select: { code: true } } },
  });

  if (oldest === null || oldest.id === batchItem.id) {
    return;
  }

  throw new BadRequestException(
    `Primero hay que cargar el lote "${oldest.batch.code}", que es el más antiguo con unidades disponibles de ese tipo de envase`,
  );
}

/**
 * El 409 de terminar una ruta con paradas pendientes, en singular y en plural.
 *
 * «Entregada / no entregada» es el vocabulario de `STOP_STATUS_LABELS` en la
 * web (`components/route-status-badge.tsx`): quien lee el error ve en la misma
 * pantalla esas dos palabras en los badges de sus paradas. El mensaje **no**
 * interpola ningún enum a propósito — hay una deuda abierta por seis mensajes
 * de este mismo servicio que sí lo hacen («Seis mensajes de RoutesService
 * interpolan el enum crudo», en `docs/backlog-tecnico.md`), y este no la
 * agranda.
 */
function unresolvedStopsMessage(pendingStops: number): string {
  const count = pendingStops === 1 ? "queda 1 parada" : `quedan ${pendingStops} paradas`;
  return `No se puede terminar la ruta: ${count} sin resolver. Cada parada tiene que quedar marcada (entregada o no entregada) o quitarse de la ruta.`;
}

/**
 * Qué campos admite cada estado destino, para marcar y para corregir por
 * igual: la combinación válida es la misma en las dos operaciones —una parada
 * no entregada no tiene qué vender y una entregada no tiene motivo de falla—
 * así que la regla vive una sola vez.
 *
 * `status` decide qué es obligatorio y qué está prohibido, algo que un
 * decorador de class-validator no expresa; por eso queda acá y no en el DTO
 * (misma nota que ya llevan `MarkRouteStopDto` y `CreateRouteStopDto`).
 */
function assertMarkPayloadMatchesStatus(dto: MarkRouteStopDto): void {
  if (dto.status === StopStatus.FAILED) {
    if ((dto.failureReason ?? "").trim().length === 0) {
      throw new BadRequestException("Una parada fallida necesita un motivo");
    }
    if (
      dto.items !== undefined ||
      dto.containersReturned !== undefined ||
      dto.payment !== undefined ||
      dto.priceOverrideAuthorizedById !== undefined
    ) {
      throw new BadRequestException("Una parada fallida no lleva datos de entrega");
    }
    return;
  }

  if (dto.failureReason !== undefined) {
    throw new BadRequestException("Una parada entregada no lleva motivo de falla");
  }
  if (dto.items === undefined || dto.items.length === 0) {
    throw new BadRequestException("La entrega debe indicar los ítems vendidos (items)");
  }
}

/**
 * Lima está en UTC-5 todo el año (no tiene horario de verano), así que su
 * mediodía es siempre las 17:00 UTC. `routes.date` es una columna `date` y
 * Prisma la entrega como la medianoche UTC de ese día calendario, de modo que
 * el mediodía de Lima es esa medianoche más 17 horas — la misma conversión que
 * `limaDayStartUtc` en container-movements, corrida medio día.
 *
 * Se acota por el instante actual porque `ContainerMovementsService` rechaza un
 * movimiento con fecha futura: corregir una parada de la ruta de HOY antes del
 * mediodía mandaría un instante que todavía no ocurrió y la corrección se
 * caería con un mensaje que no tiene nada que ver con lo que el usuario hizo.
 */
function limaNoonOfBusinessDate(businessDate: Date, now: Date): Date {
  const limaNoon = new Date(businessDate.getTime() + 17 * 60 * 60 * 1000);
  return limaNoon.getTime() > now.getTime() ? now : limaNoon;
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
