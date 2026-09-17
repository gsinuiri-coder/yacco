import type { Route, RouteStatus, StopOrigin, StopStatus } from "@yacco/shared";

type BadgeColor = "warning" | "info" | "success" | "error" | "neutral";

/** Vocabulario de la planta para los estados de una ruta. */
export const ROUTE_STATUS: Record<RouteStatus, { label: string; color: BadgeColor }> = {
  PLANNED: { label: "Planificada", color: "warning" },
  IN_PROGRESS: { label: "En curso", color: "info" },
  FINISHED: { label: "Terminada", color: "success" },
  // Cerrada y archivada: ya no queda nada que hacerle.
  SETTLED: { label: "Liquidada", color: "neutral" },
};

export const STOP_STATUS: Record<StopStatus, { label: string; color: BadgeColor }> = {
  PENDING: { label: "Pendiente", color: "warning" },
  DELIVERED: { label: "Entregada", color: "success" },
  FAILED: { label: "No entregada", color: "error" },
};

/** De dónde salió la parada: un pedido tomado antes, o una venta en la calle. */
export const STOP_ORIGIN: Record<StopOrigin, string> = {
  ORDER: "Pedido",
  VAN_SALE: "Autoventa",
};

function count(quantity: number, singular: string, plural: string): string {
  return `${quantity} ${quantity === 1 ? singular : plural}`;
}

/**
 * Lo que la oficina quiere ver de un vistazo: cuántas paradas tiene la ruta y
 * cuántas quedan. El desglose sólo aparece cuando ya se resolvió alguna: en una
 * ruta recién planificada, "3 pendientes" debajo de "3 paradas" no dice nada.
 */
export function summarizeStops(route: Pick<Route, "stops">): {
  total: string;
  resolved: string | null;
} {
  const total = route.stops.length;
  if (total === 0) return { total: "Sin paradas", resolved: null };
  const delivered = route.stops.filter((stop) => stop.status === "DELIVERED").length;
  const failed = route.stops.filter((stop) => stop.status === "FAILED").length;
  const pending = total - delivered - failed;

  const parts: string[] = [];
  if (delivered > 0) parts.push(count(delivered, "entregada", "entregadas"));
  if (failed > 0) parts.push(count(failed, "no entregada", "no entregadas"));
  if (pending > 0 && parts.length > 0) parts.push(count(pending, "pendiente", "pendientes"));
  return {
    total: count(total, "parada", "paradas"),
    resolved: parts.length === 0 ? null : parts.join(" · "),
  };
}
