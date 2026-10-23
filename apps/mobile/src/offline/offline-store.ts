import type { RouteSnapshot, SyncOperationEnvelope } from "@yacco/shared";

/**
 * Dónde está una operación de la cola, visto desde el celular. Lo que la
 * oficina ve del lado del servidor (APPLIED, DUPLICATE, REJECTED) se resume
 * en estos tres estados para el chofer.
 */
export type QueuedOperationState = "PENDING" | "SENT" | "IN_REVIEW";

/** Lo que el chofer lee junto a cada operación. */
export const QUEUED_OPERATION_STATE_LABELS: Record<QueuedOperationState, string> = {
  PENDING: "Pendiente de enviar",
  SENT: "Enviada",
  IN_REVIEW: "La oficina la revisa",
};

export interface QueuedOperation {
  envelope: SyncOperationEnvelope;
  state: QueuedOperationState;
  /** Por qué el servidor la rechazó la última vez, si la rechazó. */
  reason: string | null;
}

/**
 * Lo que el celular guarda para trabajar sin señal: la ruta descargada y la
 * cola de operaciones. En el celular es SQLite (sqlite-offline-store.ts); en
 * los tests, memoria.
 *
 * La ruta es de la sesión: se borra al cerrarla. La cola NUNCA se borra: cada
 * operación queda a nombre del chofer que la hizo y solo él la ve y la envía
 * (decisión de Giancarlo, 2026-10-23).
 */
export interface OfflineStore {
  saveSnapshot(snapshot: RouteSnapshot): Promise<void>;
  loadSnapshot(): Promise<RouteSnapshot | null>;
  clearSnapshot(): Promise<void>;
  addOperation(envelope: SyncOperationEnvelope, driverId: string): Promise<void>;
  /**
   * Las de ese chofer, en el orden en que las hizo: `clientTimestamp`, y a
   * igual hora, el de llegada.
   */
  listOperations(driverId: string): Promise<QueuedOperation[]>;
  setOperationState(id: string, state: QueuedOperationState, reason: string | null): Promise<void>;
}
