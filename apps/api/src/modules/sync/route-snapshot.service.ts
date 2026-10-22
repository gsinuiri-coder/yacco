import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, RouteStatus, UserRole } from "@prisma/client";
import { NEARBY_RADIUS_M, distanceInMeters, toRadians } from "../../common/geo.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { resolveEffectivePrices } from "../customer-prices/customer-prices.service.js";
import { formatBusinessDate, parseBusinessDate } from "../orders/orders.service.js";
import { RoutesService } from "../routes/routes.service.js";
import type { RouteActor } from "../routes/routes.service.js";
import type {
  RouteSnapshotDto,
  RouteSnapshotQueryDto,
  SnapshotLocationDto,
  SnapshotOrderDto,
} from "./dto/route-snapshot.dto.js";

const METERS_PER_DEGREE_LATITUDE = 111_320;
const LIMA_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" });

/**
 * Lo que la app necesita de cada local para marcar la parada sin señal: el
 * cliente con su deuda, los envases y accesorios que tiene, y TODOS los precios
 * pactados del cliente —los de cualquier local—, de los que
 * `resolveEffectivePrices` elige los de este.
 */
const SNAPSHOT_LOCATION_SELECT = {
  id: true,
  name: true,
  address: true,
  addressReference: true,
  phone: true,
  contactName: true,
  latitude: true,
  longitude: true,
  customer: {
    select: {
      id: true,
      name: true,
      debtBalance: true,
      creditLimit: true,
      prices: { select: { productId: true, locationId: true, price: true } },
    },
  },
  balances: {
    where: { quantity: { not: 0 } },
    select: { quantity: true, containerType: { select: { id: true, name: true } } },
    orderBy: { containerType: { name: "asc" } },
  },
  accessoryBalances: {
    where: { quantity: { not: 0 } },
    select: { quantity: true, product: { select: { id: true, name: true } } },
    orderBy: { product: { name: "asc" } },
  },
} satisfies Prisma.CustomerLocationSelect;

type SnapshotLocationRow = Prisma.CustomerLocationGetPayload<{
  select: typeof SNAPSHOT_LOCATION_SELECT;
}>;

/** Un local donde se puede hacer una venta en ruta: activo, de un cliente activo. */
const VAN_SALE_LOCATION = {
  active: true,
  customer: { active: true },
} satisfies Prisma.CustomerLocationWhereInput;

/**
 * La lectura de la app del chofer (Fase 3, fila 11b, decisión de Giancarlo
 * del 2026-10-22): un solo endpoint, solo para la app, con lo que hace falta
 * para trabajar el día sin señal. No abre al chofer ningún endpoint de la
 * oficina: la deuda, los saldos y los accesorios de un local salen acá y
 * SOLO para los locales de su ruta y los que puede visitar en venta en ruta.
 */
@Injectable()
export class RouteSnapshotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly routesService: RoutesService,
  ) {}

  async build(
    query: RouteSnapshotQueryDto,
    actor: RouteActor,
    now = new Date(),
  ): Promise<RouteSnapshotDto> {
    const routeId = await this.resolveRouteId(query.routeId, actor, now);
    const [route, truckStock] = await Promise.all([
      this.routesService.findOne(routeId, actor),
      this.routesService.truckStock(routeId, actor),
    ]);

    const stopLocationIds = new Set(route.stops.map((stop) => stop.locationId));
    const vanSaleLocationIds = await this.vanSaleLocationIds(route.zoneId, query);
    const locationIds = [...new Set([...stopLocationIds, ...vanSaleLocationIds])];

    const [locations, products, containerTypes, paymentMethods, orders] = await Promise.all([
      this.prisma.customerLocation.findMany({
        where: { id: { in: locationIds } },
        select: SNAPSHOT_LOCATION_SELECT,
        orderBy: [{ customer: { name: "asc" } }, { name: "asc" }],
      }),
      this.prisma.product.findMany({
        where: { active: true },
        select: {
          id: true,
          name: true,
          type: true,
          listPrice: true,
          containerType: { select: { id: true, name: true } },
        },
        orderBy: { name: "asc" },
      }),
      this.prisma.containerType.findMany({
        where: { active: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      this.prisma.paymentMethod.findMany({
        where: { active: true },
        select: { id: true, name: true, requiresConfirmation: true },
        orderBy: { name: "asc" },
      }),
      this.stopOrders(route.stops),
    ]);

    return {
      generatedAt: now,
      route,
      truckStock,
      locations: locations.map((location) =>
        toSnapshotLocation(location, products, stopLocationIds.has(location.id)),
      ),
      orders,
      products: products.map(({ id, name, type, containerType }) => ({
        id,
        name,
        type,
        containerType,
      })),
      containerTypes,
      paymentMethods,
    };
  }

  /**
   * Sin `routeId`: la ruta del chofer en curso y, si no tiene ninguna, la de
   * hoy (America/Lima). Con `routeId`, el ADMIN abre cualquiera —es para
   * probar—; para el chofer, una que no es la de hoy ni está en curso es 404
   * —el celular no guarda días que no trabaja— y una ajena es el 403 de
   * `RoutesService.findOne`, la misma regla que «Mi ruta».
   */
  private async resolveRouteId(
    routeId: string | undefined,
    actor: RouteActor,
    now: Date,
  ): Promise<string> {
    const today = parseBusinessDate(LIMA_DAY.format(now), "La fecha de hoy");
    if (routeId === undefined) {
      const route =
        (await this.prisma.route.findFirst({
          where: { driverId: actor.id, status: RouteStatus.IN_PROGRESS },
          orderBy: { date: "desc" },
          select: { id: true },
        })) ??
        (await this.prisma.route.findUnique({
          where: { driverId_date: { driverId: actor.id, date: today } },
          select: { id: true },
        }));
      if (route === null) {
        throw new NotFoundException("No tienes una ruta para hoy");
      }
      return route.id;
    }

    const route = await this.prisma.route.findUnique({
      where: { id: routeId },
      select: { id: true, driverId: true, status: true, date: true },
    });
    if (route === null) {
      throw new NotFoundException(`La ruta "${routeId}" no existe`);
    }
    if (actor.roles.includes(UserRole.ADMIN)) {
      return route.id;
    }
    const isToday = formatBusinessDate(route.date) === formatBusinessDate(today);
    if (route.status !== RouteStatus.IN_PROGRESS && !isToday) {
      throw new NotFoundException("Esa ruta no es la de hoy ni está en curso");
    }
    return route.id;
  }

  /**
   * Los locales que la app ofrece para una venta en ruta: los de la zona de
   * la ruta y, si el celular mandó dónde está, los que tienen coordenadas a
   * menos de 1 km. Primero una caja por grados —que usa la base— y después la
   * distancia de verdad.
   */
  private async vanSaleLocationIds(
    zoneId: string | null,
    query: RouteSnapshotQueryDto,
  ): Promise<string[]> {
    const ids: string[] = [];
    if (zoneId !== null) {
      const inZone = await this.prisma.customerLocation.findMany({
        where: { ...VAN_SALE_LOCATION, customer: { active: true, zoneId } },
        select: { id: true },
      });
      ids.push(...inZone.map((location) => location.id));
    }
    if (query.latitude === undefined || query.longitude === undefined) {
      return ids;
    }

    const latitude = Number(query.latitude);
    const longitude = Number(query.longitude);
    const latitudeDelta = NEARBY_RADIUS_M / METERS_PER_DEGREE_LATITUDE;
    const longitudeDelta =
      NEARBY_RADIUS_M /
      (METERS_PER_DEGREE_LATITUDE * Math.max(Math.cos(toRadians(latitude)), 0.01));
    const candidates = await this.prisma.customerLocation.findMany({
      where: {
        ...VAN_SALE_LOCATION,
        latitude: {
          gte: new Prisma.Decimal(latitude - latitudeDelta),
          lte: new Prisma.Decimal(latitude + latitudeDelta),
        },
        longitude: {
          gte: new Prisma.Decimal(longitude - longitudeDelta),
          lte: new Prisma.Decimal(longitude + longitudeDelta),
        },
      },
      select: { id: true, latitude: true, longitude: true },
    });
    for (const candidate of candidates) {
      if (candidate.latitude === null || candidate.longitude === null) continue;
      const distance = distanceInMeters(
        latitude,
        longitude,
        candidate.latitude.toNumber(),
        candidate.longitude.toNumber(),
      );
      if (distance <= NEARBY_RADIUS_M) ids.push(candidate.id);
    }
    return ids;
  }

  private async stopOrders(
    stops: { id: string; orderId: string | null }[],
  ): Promise<SnapshotOrderDto[]> {
    const stopByOrder = new Map(
      stops
        .filter((stop): stop is { id: string; orderId: string } => stop.orderId !== null)
        .map((stop) => [stop.orderId, stop.id] as const),
    );
    if (stopByOrder.size === 0) return [];

    const orders = await this.prisma.order.findMany({
      where: { id: { in: [...stopByOrder.keys()] } },
      select: {
        id: true,
        items: {
          select: {
            quantity: true,
            unitPrice: true,
            product: { select: { id: true, name: true, type: true } },
          },
          orderBy: { product: { name: "asc" } },
        },
      },
    });
    return orders.map((order) => ({
      id: order.id,
      stopId: stopByOrder.get(order.id) as string,
      items: order.items.map((item) => ({
        product: { id: item.product.id, name: item.product.name },
        productType: item.product.type,
        quantity: item.quantity,
        unitPrice: item.unitPrice.toFixed(2),
      })),
    }));
  }
}

function toSnapshotLocation(
  location: SnapshotLocationRow,
  products: Parameters<typeof resolveEffectivePrices>[0],
  onRoute: boolean,
): SnapshotLocationDto {
  const { customer } = location;
  return {
    id: location.id,
    name: location.name,
    address: location.address,
    addressReference: location.addressReference,
    phone: location.phone,
    contactName: location.contactName,
    latitude: location.latitude?.toFixed(6) ?? null,
    longitude: location.longitude?.toFixed(6) ?? null,
    onRoute,
    customer: { id: customer.id, name: customer.name },
    debtBalance: customer.debtBalance.toFixed(2),
    creditLimit: customer.creditLimit?.toFixed(2) ?? null,
    containerBalances: location.balances,
    loanedAccessories: location.accessoryBalances,
    prices: resolveEffectivePrices(products, customer.prices, location.id),
  };
}
