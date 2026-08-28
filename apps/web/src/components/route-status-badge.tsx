import type { RouteStatus, StopOrigin, StopStatus } from "../api/routes";

/** Vocabulario de la planta, compartido por la lista de rutas y el detalle. */
export const ROUTE_STATUS_LABELS: Record<RouteStatus, string> = {
  PLANNED: "Planificada",
  IN_PROGRESS: "En curso",
  FINISHED: "Terminada",
  SETTLED: "Liquidada",
};

const ROUTE_STATUS_BADGE_CLASS: Record<RouteStatus, string> = {
  PLANNED: "badge--warning",
  IN_PROGRESS: "badge--info",
  FINISHED: "badge--active",
  // Cerrada y archivada: ya no hay nada que hacerle.
  SETTLED: "badge--muted",
};

export function RouteStatusBadge({ status }: { status: RouteStatus }) {
  return (
    <span className={`badge ${ROUTE_STATUS_BADGE_CLASS[status]}`}>
      {ROUTE_STATUS_LABELS[status]}
    </span>
  );
}

export const STOP_STATUS_LABELS: Record<StopStatus, string> = {
  PENDING: "Pendiente",
  DELIVERED: "Entregada",
  FAILED: "No entregada",
};

const STOP_STATUS_BADGE_CLASS: Record<StopStatus, string> = {
  PENDING: "badge--warning",
  DELIVERED: "badge--active",
  FAILED: "badge--danger",
};

export function StopStatusBadge({ status }: { status: StopStatus }) {
  return (
    <span className={`badge ${STOP_STATUS_BADGE_CLASS[status]}`}>{STOP_STATUS_LABELS[status]}</span>
  );
}

/** De dónde salió la parada: de un pedido tomado antes, o de vender en la calle. */
export const STOP_ORIGIN_LABELS: Record<StopOrigin, string> = {
  ORDER: "Pedido",
  VAN_SALE: "Autoventa",
};
