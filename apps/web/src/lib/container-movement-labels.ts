import type { ContainerState } from "../api/container-inventory";
import type { ContainerMovementType } from "../api/container-movements";
import { CONTAINER_STATE_LABELS } from "./container-inventory";

/** Every ContainerMovementType, not just the three this screen can register:
 * the history shows the whole ledger, including what other processes emit. */
export const CONTAINER_MOVEMENT_TYPE_LABELS: Record<ContainerMovementType, string> = {
  FLEET_ENTRY: "Ingreso de envases nuevos",
  FILLING: "Llenado",
  ROUTE_LOAD: "Carga a ruta",
  LOAN_DELIVERY: "Entrega al cliente",
  EMPTY_PICKUP: "Recogida de vacíos",
  FULL_RETURN: "Devolución a planta",
  EMPTY_UNLOAD: "Descarga de vacíos",
  FULL_SALE: "Venta",
  DAMAGE_WRITE_OFF: "Baja por daño",
  LOSS_WRITE_OFF: "Baja por pérdida",
};

/** "de dónde sale" phrasing for the origin picker — plain-language, not the enum. */
export const CONTAINER_STATE_ORIGIN_LABELS: Record<ContainerState, string> = {
  EMPTY_AT_PLANT: "de los vacíos en planta",
  FULL_AT_PLANT: "de los llenos en planta",
  FULL_ON_ROUTE: "de los llenos en camión",
  EMPTY_ON_ROUTE: "de los vacíos en camión",
  WITH_CUSTOMER: "de los que están en poder del cliente",
};

const OUTSIDE_FLEET_LABEL = "Fuera de la empresa";

/** History row's "de qué estado a cuál", reusing the inventory screen's state names. */
export function formatStateTransition(
  from: ContainerState | null,
  to: ContainerState | null,
): string {
  const fromLabel = from === null ? OUTSIDE_FLEET_LABEL : CONTAINER_STATE_LABELS[from];
  const toLabel = to === null ? OUTSIDE_FLEET_LABEL : CONTAINER_STATE_LABELS[to];
  return `${fromLabel} → ${toLabel}`;
}
