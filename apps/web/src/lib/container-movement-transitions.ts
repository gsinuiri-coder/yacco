import type { ContainerState } from "../api/container-inventory";

/**
 * Copia manual de CONTAINER_MOVEMENT_TRANSITIONS
 * (apps/api/src/modules/container-movements/container-movement-transitions.ts),
 * acotada a las tres operaciones que esta pantalla ofrece. La fuente de
 * verdad es siempre el backend: si su matriz cambia y este espejo queda
 * desactualizado, `POST /container-movements` igual valida la transición, así
 * que un desfase se manifiesta como un 400 con el mensaje real del servidor
 * — nunca como datos corruptos ni como un envío aceptado en silencio. Ver
 * docs/backlog-tecnico.md: la solución definitiva es mover el módulo del
 * backend a packages/shared y que ambos lados importen de ahí.
 */
export type AllowedMovementType = "FLEET_ENTRY" | "DAMAGE_WRITE_OFF" | "LOSS_WRITE_OFF";

export interface StateTransition {
  from: ContainerState | null;
  to: ContainerState | null;
}

const ALL_STATES: ContainerState[] = [
  "EMPTY_AT_PLANT",
  "FULL_AT_PLANT",
  "FULL_ON_ROUTE",
  "EMPTY_ON_ROUTE",
  "WITH_CUSTOMER",
];

export const MOVEMENT_TRANSITIONS: Record<AllowedMovementType, StateTransition[]> = {
  FLEET_ENTRY: [{ from: null, to: "EMPTY_AT_PLANT" }],
  // Damage can be found in any state the container was already in.
  DAMAGE_WRITE_OFF: ALL_STATES.map((from) => ({ from, to: null })),
  LOSS_WRITE_OFF: [{ from: "WITH_CUSTOMER", to: null }],
};

export const ALLOWED_MOVEMENT_TYPES = Object.keys(MOVEMENT_TRANSITIONS) as AllowedMovementType[];

/** Every origin a type's matrix allows, in the matrix's own order. */
export function originsFor(type: AllowedMovementType): (ContainerState | null)[] {
  return MOVEMENT_TRANSITIONS[type].map((pair) => pair.from);
}

/**
 * The destination for a type. Every pair for these three types shares one
 * destination regardless of which origin is chosen, so this never depends
 * on the origin — unlike the backend's general matrix, which is not true
 * for every type (e.g. FULL_SALE, out of scope here).
 */
export function destinationFor(type: AllowedMovementType): ContainerState | null {
  return MOVEMENT_TRANSITIONS[type][0]?.to ?? null;
}
