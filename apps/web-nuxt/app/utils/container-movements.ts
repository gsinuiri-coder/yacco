import type { ContainerMovementType, ContainerState } from "@yacco/shared";
import { CONTAINER_STATES, CONTAINER_STATE_LABEL } from "./container-states";

/** Todas las operaciones del libro, también las que emiten otros procesos (llenado, ruta). */
export const MOVEMENT_TYPE_LABEL: Record<ContainerMovementType, string> = {
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
  OPENING_BALANCE: "Saldo de apertura",
  COUNT_ADJUSTMENT: "Ajuste por conteo",
  LOAN_DELIVERY_VOID: "Anulación de entrega",
  EMPTY_PICKUP_VOID: "Anulación de recogida",
  FULL_SALE_VOID: "Anulación de venta",
};

/** «De dónde sale», para elegir el origen de una baja. */
export const ORIGIN_LABEL: Record<ContainerState, string> = {
  EMPTY_AT_PLANT: "de los vacíos en planta",
  FULL_AT_PLANT: "de los llenos en planta",
  FULL_ON_ROUTE: "de los llenos en camión",
  EMPTY_ON_ROUTE: "de los vacíos en camión",
  WITH_CUSTOMER: "de los que están en poder del cliente",
};

/** "Vacíos en planta → Fuera de la empresa". `null` es fuera de la flota. */
export function describeTransition(from: ContainerState | null, to: ContainerState | null): string {
  const label = (state: ContainerState | null) =>
    state === null ? "Fuera de la empresa" : CONTAINER_STATE_LABEL[state];
  return `${label(from)} → ${label(to)}`;
}

/**
 * Las tres operaciones que la oficina registra a mano, con sus transiciones.
 * Es un espejo acotado de la matriz de la API: si la API cambia y esto no, la
 * API igual valida y responde 400 con su mensaje; nunca se acepta un envío
 * inválido en silencio.
 */
export type ManualMovementType = "FLEET_ENTRY" | "DAMAGE_WRITE_OFF" | "LOSS_WRITE_OFF";

interface ManualMovement {
  /** Los orígenes posibles; con más de uno, la oficina elige. */
  origins: ReadonlyArray<ContainerState | null>;
  /** El destino, el mismo para cualquier origen de estas tres operaciones. */
  destination: ContainerState | null;
}

export const MANUAL_MOVEMENTS: Record<ManualMovementType, ManualMovement> = {
  FLEET_ENTRY: { origins: [null], destination: "EMPTY_AT_PLANT" },
  // Un envase dañado puede aparecer en cualquier estado.
  DAMAGE_WRITE_OFF: { origins: CONTAINER_STATES, destination: null },
  LOSS_WRITE_OFF: { origins: ["WITH_CUSTOMER"], destination: null },
};
