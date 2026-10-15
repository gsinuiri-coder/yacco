import { Injectable } from "@nestjs/common";
import { ContainerState, OrderStatus, PaymentStatus, RouteStatus, UserRole } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service.js";
import { limaDayStartUtc } from "../container-movements/container-movements.service.js";
import { parseBusinessDate } from "../orders/orders.service.js";
import type { ContainerTypeQuantityDto } from "./dto/report-response.dto.js";
import type { PlantStockRowDto, RoleDashboardDto } from "./dto/role-dashboard.dto.js";
import { LIMA_DAY } from "./reports.service.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Quien pide el Panel: su id y sus roles salen del token, nunca de la query. */
export interface DashboardViewer {
  sub: string;
  roles: UserRole[];
}

/** Las filas por tipo de envase, de nombre en nombre, sin los tipos en cero. */
function toQuantities(byType: Map<string, ContainerTypeQuantityDto>): ContainerTypeQuantityDto[] {
  return [...byType.values()]
    .filter((line) => line.quantity !== 0)
    .sort((a, b) => a.containerType.name.localeCompare(b.containerType.name));
}

/**
 * El Panel de cada rol de la web (Fase 3, fila 9a). Cada bloque se arma solo
 * si quien pide tiene un rol que lo ve; lo que ningún rol suyo ve NO viaja:
 * el supervisor y el operador nunca reciben un monto en S/, y el operador
 * solo sus propias llenadas. Una persona con varios roles recibe la suma, y
 * lo que dos roles comparten (rutas en curso, vacíos en planta) viaja una vez.
 *
 * «Del día» es el día calendario de Lima: las fechas de negocio (pedido,
 * lote) se comparan como fecha, los instantes (venta, cobro) contra el
 * comienzo y el fin de ese día en Lima.
 */
@Injectable()
export class RoleDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard(viewer: DashboardViewer, now: Date = new Date()): Promise<RoleDashboardDto> {
    const today = LIMA_DAY.format(now);
    const has = (role: UserRole) => viewer.roles.includes(role);
    const isAdmin = has(UserRole.ADMIN);
    const isSeller = has(UserRole.SELLER);
    const isSupervisor = has(UserRole.PLANT_SUPERVISOR);
    const isOperator = has(UserRole.PLANT_OPERATOR);

    const dashboard: RoleDashboardDto = { today };
    const work: Array<Promise<void>> = [];
    if (isAdmin) work.push(this.fillAdmin(dashboard, today));
    if (isSeller) work.push(this.fillSeller(dashboard, today));
    if (isAdmin || isSeller) {
      work.push(
        this.prisma.route
          .count({ where: { status: RouteStatus.IN_PROGRESS } })
          .then((count) => void (dashboard.routesInProgress = count)),
      );
    }
    if (isSupervisor) work.push(this.fillSupervisor(dashboard, today));
    if (isOperator) work.push(this.fillOperator(dashboard, today, viewer.sub, !isSupervisor));
    await Promise.all(work);
    return dashboard;
  }

  /** Ventas y cobros del día, y la deuda total: lo que ve el administrador. */
  private async fillAdmin(dashboard: RoleDashboardDto, today: string): Promise<void> {
    const soldAt = {
      gte: limaDayStartUtc(today),
      lt: new Date(limaDayStartUtc(today).getTime() + DAY_MS),
    };
    const [sales, payments, debt] = await Promise.all([
      // El saldo inicial del padrón no es una venta del día (schema.prisma).
      this.prisma.sale.aggregate({
        where: { voidedAt: null, isOpeningBalance: false, soldAt },
        _sum: { total: true },
      }),
      // Un cobro pendiente o rechazado todavía no es plata en la mano.
      this.prisma.payment.aggregate({
        where: {
          voidedAt: null,
          isOpeningBalance: false,
          status: PaymentStatus.CONFIRMED,
          paidAt: soldAt,
        },
        _sum: { amount: true },
      }),
      // Solo lo que se debe: un saldo a favor no descuenta la deuda de otro.
      this.prisma.customer.aggregate({
        where: { debtBalance: { gt: 0 } },
        _sum: { debtBalance: true },
      }),
    ]);
    dashboard.salesToday = (sales._sum.total ?? 0).toFixed(2);
    dashboard.paymentsToday = (payments._sum.amount ?? 0).toFixed(2);
    dashboard.totalDebt = (debt._sum.debtBalance ?? 0).toFixed(2);
  }

  /** Pedidos del día, no entregados sin reprogramar y cobros por confirmar. */
  private async fillSeller(dashboard: RoleDashboardDto, today: string): Promise<void> {
    const [ordersToday, undeliveredOrders, pending] = await Promise.all([
      this.prisma.order.count({
        where: {
          deliveryDate: parseBusinessDate(today, "Hoy"),
          status: { not: OrderStatus.CANCELLED },
        },
      }),
      // La misma regla que la pantalla «No entregados».
      this.prisma.order.count({
        where: { status: OrderStatus.FAILED, rescheduledTo: { is: null } },
      }),
      this.prisma.payment.aggregate({
        where: { voidedAt: null, status: PaymentStatus.PENDING },
        _count: { _all: true },
        _sum: { amount: true },
      }),
    ]);
    dashboard.ordersToday = ordersToday;
    dashboard.undeliveredOrders = undeliveredOrders;
    dashboard.pendingPayments = {
      count: pending._count._all,
      amount: (pending._sum.amount ?? 0).toFixed(2),
    };
  }

  /** Producción del día, vacíos y llenos en planta, y la maquila pendiente. */
  private async fillSupervisor(dashboard: RoleDashboardDto, today: string): Promise<void> {
    const [producedToday, plantStock, maquila] = await Promise.all([
      this.filledOn(today),
      this.plantStock(),
      this.prisma.maquilaBalance.aggregate({ _sum: { emptyAtPlant: true, fullToReturn: true } }),
    ]);
    dashboard.producedToday = producedToday;
    dashboard.plantStock = plantStock;
    dashboard.maquilaPending = {
      emptyToFill: maquila._sum.emptyAtPlant ?? 0,
      fullToReturn: maquila._sum.fullToReturn ?? 0,
    };
  }

  /**
   * Las llenadas de hoy del operador, solo las suyas, y los vacíos que hay
   * para llenar. Si además es supervisor, los vacíos ya viajan en el stock de
   * planta: no se repiten.
   */
  private async fillOperator(
    dashboard: RoleDashboardDto,
    today: string,
    operatorId: string,
    withEmptyStock: boolean,
  ): Promise<void> {
    const [mine, stock] = await Promise.all([
      this.filledOn(today, operatorId),
      withEmptyStock ? this.plantStock() : Promise.resolve(null),
    ]);
    dashboard.myFillingsToday = mine;
    if (stock !== null) {
      dashboard.emptyToFill = stock
        .filter((row) => row.empty !== 0)
        .map((row) => ({ containerType: row.containerType, quantity: row.empty }));
    }
  }

  /** Lo llenado en lotes con fecha `day`, por tipo; de un solo operador si se pide. */
  private async filledOn(day: string, recordedById?: string): Promise<ContainerTypeQuantityDto[]> {
    const items = await this.prisma.batchItem.findMany({
      where: {
        batch: { date: parseBusinessDate(day, "Hoy") },
        ...(recordedById === undefined ? {} : { recordedById }),
      },
      select: { producedQty: true, containerType: { select: { id: true, name: true } } },
    });
    const byType = new Map<string, ContainerTypeQuantityDto>();
    for (const item of items) {
      const line = byType.get(item.containerType.id) ?? {
        containerType: item.containerType,
        quantity: 0,
      };
      line.quantity += item.producedQty;
      byType.set(item.containerType.id, line);
    }
    return toQuantities(byType);
  }

  /**
   * Vacíos y llenos en planta por tipo, leídos del libro como el inventario:
   * lo que entró a cada estado menos lo que salió. Un tipo retirado aparece
   * solo si todavía tiene algo en planta.
   */
  private async plantStock(): Promise<PlantStockRowDto[]> {
    const states = [ContainerState.EMPTY_AT_PLANT, ContainerState.FULL_AT_PLANT];
    const [containerTypes, into, outOf] = await Promise.all([
      this.prisma.containerType.findMany({
        select: { id: true, name: true, active: true },
        orderBy: { name: "asc" },
      }),
      this.prisma.containerMovement.groupBy({
        by: ["containerTypeId", "toState"],
        where: { toState: { in: states } },
        _sum: { quantity: true },
      }),
      this.prisma.containerMovement.groupBy({
        by: ["containerTypeId", "fromState"],
        where: { fromState: { in: states } },
        _sum: { quantity: true },
      }),
    ]);
    const net = new Map<string, number>();
    for (const row of into) {
      const key = `${row.containerTypeId}:${row.toState}`;
      net.set(key, (net.get(key) ?? 0) + (row._sum.quantity ?? 0));
    }
    for (const row of outOf) {
      const key = `${row.containerTypeId}:${row.fromState}`;
      net.set(key, (net.get(key) ?? 0) - (row._sum.quantity ?? 0));
    }
    return containerTypes
      .map((containerType) => ({
        containerType: { id: containerType.id, name: containerType.name },
        active: containerType.active,
        empty: net.get(`${containerType.id}:${ContainerState.EMPTY_AT_PLANT}`) ?? 0,
        full: net.get(`${containerType.id}:${ContainerState.FULL_AT_PLANT}`) ?? 0,
      }))
      .filter((row) => row.active || row.empty !== 0 || row.full !== 0)
      .map(({ containerType, empty, full }) => ({ containerType, empty, full }));
  }
}
