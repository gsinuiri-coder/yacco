import { formatSoles } from "@yacco/shared";
import type { ContainerTypeQuantity, PlantStockRow, RoleDashboard } from "@yacco/shared";

/** Un número del Panel: qué es, cuánto, y la pantalla donde se ve su detalle. */
export interface DashboardTile {
  label: string;
  value: string;
  to: string;
}

/** «Con caño 40 · Sin caño 3»; sin ninguno, «0». */
export function byTypeText(lines: ContainerTypeQuantity[]): string {
  if (lines.length === 0) return "0";
  return lines.map((line) => `${line.containerType.name} ${line.quantity}`).join(" · ");
}

function stockText(stock: PlantStockRow[], pick: "empty" | "full"): string {
  return byTypeText(
    stock
      .filter((row) => row[pick] !== 0)
      .map((row) => ({ containerType: row.containerType, quantity: row[pick] })),
  );
}

function withQuery(path: string, query: Record<string, string>): string {
  return `${path}?${new URLSearchParams(query).toString()}`;
}

/**
 * Las tarjetas del Panel, en el orden en que se leen: oficina primero, planta
 * después. Cada una sale de un campo que la API mandó; lo que no vino (porque
 * ningún rol de quien mira lo ve) no tiene tarjeta, y lo que dos roles
 * comparten viene una sola vez, así que tampoco se repite acá.
 */
export function dashboardTiles(dashboard: RoleDashboard): DashboardTile[] {
  const { today, pendingPayments, plantStock, maquilaPending } = dashboard;
  const todayProduction = withQuery("/production", { dateFrom: today, dateTo: today });
  const candidates: Array<DashboardTile | null> = [
    dashboard.salesToday === undefined
      ? null
      : {
          label: "Ventas del día",
          value: formatSoles(dashboard.salesToday),
          to: withQuery("/sales", { soldFrom: today, soldTo: today }),
        },
    dashboard.paymentsToday === undefined
      ? null
      : {
          label: "Cobros del día",
          value: formatSoles(dashboard.paymentsToday),
          to: withQuery("/payments", { status: "CONFIRMED", paidFrom: today, paidTo: today }),
        },
    dashboard.totalDebt === undefined
      ? null
      : { label: "Deuda total", value: formatSoles(dashboard.totalDebt), to: "/reports/debt" },
    dashboard.ordersToday === undefined
      ? null
      : {
          label: "Pedidos del día",
          value: String(dashboard.ordersToday),
          to: withQuery("/orders", {
            status: "NOT_CANCELLED",
            deliveryDateFrom: today,
            deliveryDateTo: today,
          }),
        },
    dashboard.undeliveredOrders === undefined
      ? null
      : {
          label: "No entregados",
          value: String(dashboard.undeliveredOrders),
          to: "/orders/undelivered",
        },
    dashboard.routesInProgress === undefined
      ? null
      : {
          label: "Rutas en curso",
          value: String(dashboard.routesInProgress),
          to: withQuery("/routes", { status: "IN_PROGRESS" }),
        },
    pendingPayments === undefined
      ? null
      : {
          label: "Cobros por confirmar",
          value: `${pendingPayments.count} · ${formatSoles(pendingPayments.amount)}`,
          to: withQuery("/payments", { status: "PENDING" }),
        },
    dashboard.producedToday === undefined
      ? null
      : {
          label: "Producción del día",
          value: byTypeText(dashboard.producedToday),
          to: todayProduction,
        },
    dashboard.myFillingsToday === undefined
      ? null
      : {
          label: "Mis llenadas de hoy",
          value: byTypeText(dashboard.myFillingsToday),
          to: todayProduction,
        },
    plantStock === undefined
      ? null
      : { label: "Vacíos en planta", value: stockText(plantStock, "empty"), to: "/inventory" },
    plantStock === undefined
      ? null
      : { label: "Llenos en planta", value: stockText(plantStock, "full"), to: "/inventory" },
    dashboard.emptyToFill === undefined
      ? null
      : {
          label: "Vacíos para llenar",
          value: byTypeText(dashboard.emptyToFill),
          to: "/inventory",
        },
    // La maquila se ve y se llena dentro de Producción.
    maquilaPending === undefined
      ? null
      : {
          label: "Maquila por llenar",
          value: String(maquilaPending.emptyToFill),
          to: "/production",
        },
    maquilaPending === undefined
      ? null
      : {
          label: "Maquila por devolver",
          value: String(maquilaPending.fullToReturn),
          to: "/production",
        },
  ];
  return candidates.filter((tile): tile is DashboardTile => tile !== null);
}
