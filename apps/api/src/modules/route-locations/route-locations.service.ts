import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, RouteStatus } from "@prisma/client";
import { ROUTE_STATUS_LABELS } from "../../common/status-labels.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { formatBusinessDate } from "../orders/orders.service.js";
import { lockRouteAndReadStatus } from "../routes/routes.service.js";
import type { RouteActor } from "../routes/routes.service.js";
import type { CreateRouteLocationPointsDto } from "./dto/create-route-location-points.dto.js";
import type {
  LiveRouteLocationsDto,
  RouteLocationPointDto,
  RouteLocationPointsReceiptDto,
} from "./dto/route-location-response.dto.js";

/**
 * Points arrive every 5 minutes: three missed in a row is what the plant
 * reads as «sin señal» (Fase 3, fila 10, decisión B.2).
 */
export const STALE_AFTER_MINUTES = 15;

const POINT_SELECT = {
  latitude: true,
  longitude: true,
  accuracyM: true,
  recordedAt: true,
  receivedAt: true,
  vehicle: { select: { plate: true } },
} satisfies Prisma.RouteLocationPointSelect;

type PointRow = Prisma.RouteLocationPointGetPayload<{ select: typeof POINT_SELECT }>;

function toPointDto(row: PointRow): RouteLocationPointDto {
  return {
    latitude: row.latitude.toFixed(6),
    longitude: row.longitude.toFixed(6),
    accuracyM: row.accuracyM?.toFixed(2) ?? null,
    recordedAt: row.recordedAt.toISOString(),
    receivedAt: row.receivedAt.toISOString(),
    vehiclePlate: row.vehicle?.plate ?? null,
  };
}

export function isWithoutSignal(lastRecordedAt: Date | null, now: Date): boolean {
  if (lastRecordedAt === null) return true;
  return now.getTime() - lastRecordedAt.getTime() > STALE_AFTER_MINUTES * 60 * 1000;
}

@Injectable()
export class RouteLocationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Only the route's own driver, and only while it is IN_PROGRESS — not even
   * an ADMIN sends points for somebody else's phone. The route row is locked
   * like every other write on a route, so a finish that lands at the same
   * moment cannot let a point slip in after it.
   *
   * `skipDuplicates` (ON CONFLICT DO NOTHING on `client_point_id`) is the
   * idempotency: a batch resent after a lost answer stores nothing twice,
   * and a point repeated inside one batch counts once.
   */
  async recordPoints(
    routeId: string,
    dto: CreateRouteLocationPointsDto,
    actor: RouteActor,
  ): Promise<RouteLocationPointsReceiptDto> {
    return this.prisma.$transaction(async (tx) => {
      const status = await lockRouteAndReadStatus(tx, routeId);
      const route = await tx.route.findUniqueOrThrow({
        where: { id: routeId },
        select: { driverId: true, vehicleId: true },
      });
      if (route.driverId !== actor.id) {
        throw new ForbiddenException("Solo el chofer de la ruta manda su ubicación");
      }
      if (status !== RouteStatus.IN_PROGRESS) {
        throw new ConflictException(
          `Solo se recibe la ubicación de una ruta en curso; esta está ${ROUTE_STATUS_LABELS[status]}`,
        );
      }

      const { count } = await tx.routeLocationPoint.createMany({
        data: dto.points.map((point) => ({
          clientPointId: point.clientPointId,
          routeId,
          driverId: route.driverId,
          vehicleId: route.vehicleId,
          latitude: new Prisma.Decimal(point.latitude),
          longitude: new Prisma.Decimal(point.longitude),
          accuracyM: point.accuracyM === undefined ? null : new Prisma.Decimal(point.accuracyM),
          recordedAt: new Date(point.recordedAt),
        })),
        skipDuplicates: true,
      });
      return { received: dto.points.length, stored: count };
    });
  }

  async listRoutePoints(routeId: string): Promise<RouteLocationPointDto[]> {
    const route = await this.prisma.route.findUnique({
      where: { id: routeId },
      select: { id: true },
    });
    if (route === null) {
      throw new NotFoundException(`La ruta "${routeId}" no existe`);
    }
    const rows = await this.prisma.routeLocationPoint.findMany({
      where: { routeId },
      orderBy: [{ recordedAt: "asc" }, { receivedAt: "asc" }],
      select: POINT_SELECT,
    });
    return rows.map(toPointDto);
  }

  /** `now` is a parameter so the «sin señal» boundary can be tested. */
  async listLive(now: Date = new Date()): Promise<LiveRouteLocationsDto> {
    const routes = await this.prisma.route.findMany({
      where: { status: RouteStatus.IN_PROGRESS },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        date: true,
        driver: { select: { name: true } },
        vehicle: { select: { plate: true } },
        zone: { select: { name: true } },
        locationPoints: {
          orderBy: [{ recordedAt: "desc" }, { receivedAt: "desc" }],
          take: 1,
          select: POINT_SELECT,
        },
      },
    });

    return {
      staleAfterMinutes: STALE_AFTER_MINUTES,
      routes: routes.map((route) => {
        const last = route.locationPoints[0] ?? null;
        return {
          routeId: route.id,
          date: formatBusinessDate(route.date),
          driverName: route.driver.name,
          vehiclePlate: route.vehicle?.plate ?? null,
          zoneName: route.zone?.name ?? null,
          lastPoint: last === null ? null : toPointDto(last),
          noSignal: isWithoutSignal(last?.recordedAt ?? null, now),
        };
      }),
    };
  }
}
