import type { Route, RouteLocationPointPayloadV1, RouteStartPayloadV1 } from "@yacco/shared";

import type { QueuedOperation } from "./offline-store";

/** El último «Empezar la ruta» que el celular hizo para esta ruta. */
export function lastStartOf(
  operations: QueuedOperation[],
  routeId: string,
): QueuedOperation | null {
  return (
    operations.findLast(
      (op) =>
        op.envelope.type === "ROUTE_START" &&
        (op.envelope.payload as unknown as RouteStartPayloadV1).routeId === routeId,
    ) ?? null
  );
}

/**
 * Empezada en el celular, ya se trabaja: salvo que la oficina la haya
 * rechazado, que entonces gana el servidor.
 */
export function isRouteInProgress(
  route: Pick<Route, "id" | "status">,
  operations: QueuedOperation[],
): boolean {
  if (route.status === "IN_PROGRESS") return true;
  const queuedStart = lastStartOf(operations, route.id);
  return route.status === "PLANNED" && queuedStart !== null && queuedStart.state !== "IN_REVIEW";
}

/**
 * La ubicación en segundo plano sigue a la ruta mientras está en curso. Se
 * apaga sola también cuando el servidor rechazó el último punto: la oficina
 * terminó la ruta, o no es de este chofer, y la ruta guardada todavía no lo
 * sabe. Seguir mandando solo llenaría «Operaciones en revisión».
 */
export function shouldFollowRoute(
  route: Pick<Route, "id" | "status">,
  operations: QueuedOperation[],
): boolean {
  if (!isRouteInProgress(route, operations)) return false;
  const lastPoint = operations.findLast(
    (op) =>
      op.envelope.type === "ROUTE_LOCATION_POINT" &&
      (op.envelope.payload as unknown as RouteLocationPointPayloadV1).routeId === route.id,
  );
  return lastPoint?.state !== "IN_REVIEW";
}
