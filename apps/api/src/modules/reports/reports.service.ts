import { BadRequestException, Injectable } from "@nestjs/common";
import { PaymentStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service.js";
import { formatBusinessDate, parseBusinessDate } from "../orders/orders.service.js";
import type { ProductionReportQueryDto } from "./dto/production-report-query.dto.js";
import type {
  ContainerTypeQuantityDto,
  CustomerDebtRowDto,
  CustomerDebtsReportDto,
  LoanedContainerRowDto,
  LoanedContainersReportDto,
  ProducedByTypeDto,
  ProductionReportDto,
  ReportNamedDto,
} from "./dto/report-response.dto.js";

/** El día calendario de Lima de un instante: "en-CA" imprime AAAA-MM-DD. */
const LIMA_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" });

/** Un cargo (+) o un cobro (−) del libro de dinero de un cliente. */
interface DebtEvent {
  at: Date;
  delta: Prisma.Decimal;
  isCharge: boolean;
}

/**
 * La deuda de un cliente y desde cuándo, reproduciendo su libro en orden.
 *
 * "Desde cuándo" es el cargo que abrió la deuda actual: el primero después de
 * la última vez que el saldo quedó en cero o a favor. NO reparte cobros entre
 * ventas (el sistema no lo hace: ver «Reparto de un pago global entre deudas
 * del cliente» en backlog-tecnico.md), así que da la fecha más antigua
 * defendible — decisión delegada, supuesto 12 de supuestos-por-validar.md.
 *
 * A la misma hora, el cargo va antes que el cobro: si no, un cobro exacto
 * registrado en el mismo instante dejaría abierta una deuda que no existe.
 */
export function replayDebt(events: DebtEvent[]): { debt: Prisma.Decimal; openSince: Date | null } {
  const ordered = [...events].sort(
    (a, b) => a.at.getTime() - b.at.getTime() || Number(b.isCharge) - Number(a.isCharge),
  );
  let balance = new Prisma.Decimal(0);
  let openSince: Date | null = null;
  for (const event of ordered) {
    if (event.isCharge && balance.lessThanOrEqualTo(0)) openSince = event.at;
    balance = balance.plus(event.delta);
    if (balance.lessThanOrEqualTo(0)) openSince = null;
  }
  return { debt: balance, openSince };
}

function byName<T>(name: (item: T) => string) {
  return (a: T, b: T) => name(a).localeCompare(name(b));
}

/**
 * Reportes post-MVP de la spec (HU-19, HU-20, HU-21). Todos leen; ninguno
 * escribe, y ninguno confía en un número que no pueda reconstruirse.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * HU-19. La deuda sale del libro (ventas vivas menos cobros CONFIRMADOS
   * vivos), la misma regla que `debt_balance` y el estado de cuenta: una venta
   * o un cobro anulados no cuentan, un cobro PENDIENTE o RECHAZADO tampoco.
   */
  async customerDebts(): Promise<CustomerDebtsReportDto> {
    const [customers, sales, payments] = await Promise.all([
      this.prisma.customer.findMany({
        select: { id: true, name: true, zone: { select: { id: true, name: true } } },
      }),
      this.prisma.sale.findMany({
        where: { voidedAt: null },
        select: { soldAt: true, total: true, location: { select: { customerId: true } } },
      }),
      this.prisma.payment.findMany({
        where: { voidedAt: null, status: PaymentStatus.CONFIRMED },
        select: { customerId: true, paidAt: true, amount: true },
      }),
    ]);

    const events = new Map<string, DebtEvent[]>();
    const push = (customerId: string, event: DebtEvent) => {
      const list = events.get(customerId) ?? [];
      list.push(event);
      events.set(customerId, list);
    };
    for (const sale of sales) {
      push(sale.location.customerId, { at: sale.soldAt, delta: sale.total, isCharge: true });
    }
    for (const payment of payments) {
      push(payment.customerId, {
        at: payment.paidAt,
        delta: payment.amount.negated(),
        isCharge: false,
      });
    }

    const rows: CustomerDebtRowDto[] = [];
    let total = new Prisma.Decimal(0);
    for (const customer of customers) {
      const { debt, openSince } = replayDebt(events.get(customer.id) ?? []);
      if (openSince === null) continue;
      total = total.plus(debt);
      rows.push({
        customer: { id: customer.id, name: customer.name },
        zone: customer.zone,
        debt: debt.toFixed(2),
        oldestChargeDate: LIMA_DAY.format(openSince),
      });
    }
    rows.sort(
      (a, b) =>
        new Prisma.Decimal(b.debt).comparedTo(a.debt) ||
        a.customer.name.localeCompare(b.customer.name),
    );
    return { rows, total: total.toFixed(2) };
  }

  /**
   * HU-20. Los saldos materializados por locación, sumados por cliente y tipo.
   * Un saldo negativo (devolvió más de lo registrado) se muestra y suma: es un
   * hallazgo, y sacarlo haría que el total dejara de cuadrar con el parque.
   */
  async loanedContainers(): Promise<LoanedContainersReportDto> {
    const balances = await this.prisma.customerContainerBalance.findMany({
      where: { quantity: { not: 0 } },
      select: {
        quantity: true,
        containerType: { select: { id: true, name: true } },
        location: { select: { customer: { select: { id: true, name: true } } } },
      },
    });

    const rowsByKey = new Map<string, LoanedContainerRowDto>();
    const byTypeId = new Map<string, ContainerTypeQuantityDto>();
    for (const balance of balances) {
      const customer = balance.location.customer;
      const key = `${customer.id}:${balance.containerType.id}`;
      const row = rowsByKey.get(key) ?? {
        customer,
        containerType: balance.containerType,
        quantity: 0,
      };
      row.quantity += balance.quantity;
      rowsByKey.set(key, row);
      const line = byTypeId.get(balance.containerType.id) ?? {
        containerType: balance.containerType,
        quantity: 0,
      };
      line.quantity += balance.quantity;
      byTypeId.set(balance.containerType.id, line);
    }

    const rows = [...rowsByKey.values()]
      .filter((row) => row.quantity !== 0)
      .sort(
        (a, b) =>
          a.customer.name.localeCompare(b.customer.name) ||
          a.containerType.name.localeCompare(b.containerType.name),
      );
    const byType = [...byTypeId.values()].sort(byName((line) => line.containerType.name));
    return { rows, byType, total: byType.reduce((sum, line) => sum + line.quantity, 0) };
  }

  /** HU-21. Lotes del período (fecha del lote, inclusive en los dos extremos). */
  async production(query: ProductionReportQueryDto): Promise<ProductionReportDto> {
    const from = parseBusinessDate(query.dateFrom, "La fecha desde");
    const to = parseBusinessDate(query.dateTo, "La fecha hasta");
    if (from > to) {
      throw new BadRequestException("La fecha desde no puede ser posterior a la fecha hasta");
    }

    const batches = await this.prisma.productionBatch.findMany({
      where: { date: { gte: from, lte: to } },
      select: {
        id: true,
        code: true,
        date: true,
        items: {
          select: { producedQty: true, containerType: { select: { id: true, name: true } } },
        },
      },
      orderBy: [{ date: "asc" }, { code: "asc" }],
    });

    const byTypeId = new Map<string, ProducedByTypeDto>();
    const toLine = (containerType: ReportNamedDto, producedQty: number): ProducedByTypeDto => {
      const line = byTypeId.get(containerType.id) ?? { containerType, producedQty: 0 };
      line.producedQty += producedQty;
      byTypeId.set(containerType.id, line);
      return { containerType, producedQty };
    };

    const rows = batches.map((batch) => {
      const items = batch.items
        .map((item) => toLine(item.containerType, item.producedQty))
        .sort(byName((line) => line.containerType.name));
      return {
        id: batch.id,
        code: batch.code,
        date: formatBusinessDate(batch.date),
        items,
        total: items.reduce((sum, item) => sum + item.producedQty, 0),
      };
    });
    const byType = [...byTypeId.values()].sort(byName((line) => line.containerType.name));
    return {
      batches: rows,
      byType,
      total: byType.reduce((sum, line) => sum + line.producedQty, 0),
    };
  }
}
