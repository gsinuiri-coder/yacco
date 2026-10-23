import type {
  SyncBatchBody,
  SyncBatchResult,
  SyncOperationEnvelope,
  SyncOperationResult,
  SyncOperationType,
} from "@yacco/shared";

import type { ApiClient } from "../session/api-client";
import type { OfflineStore, QueuedOperationState } from "./offline-store";

/** El tope de POST /sync/operations (MAX_OPERATIONS_PER_BATCH en la API). */
export const MAX_OPERATIONS_PER_BATCH = 200;

export interface OutboxOptions {
  store: OfflineStore;
  /** Genera el UUID de cada operación en el celular. */
  newId: () => string;
  /** El reloj del celular. */
  now?: () => Date;
}

export interface FlushSummary {
  sent: number;
  inReview: number;
  stillPending: number;
}

export interface Outbox {
  /** Guarda la acción en la cola; sale cuando haya señal. */
  enqueue<TPayload extends object>(
    type: SyncOperationType,
    version: number,
    payload: TPayload,
  ): Promise<SyncOperationEnvelope>;
  /**
   * Manda lo pendiente, en el orden en que se hizo y en lotes del tope de la
   * API. Sin señal o con el servidor caído, el error sube y lo que no llegó
   * sigue pendiente: reenviarlo es seguro, el servidor reconoce el UUID.
   */
  flush(client: ApiClient): Promise<FlushSummary>;
}

function nextState(result: SyncOperationResult): QueuedOperationState {
  if (result.status !== "REJECTED") return "SENT";
  // Rechazada sin cuarentena: el servidor le da un intento más.
  return result.quarantined ? "IN_REVIEW" : "PENDING";
}

export function createOutbox({ store, newId, now = () => new Date() }: OutboxOptions): Outbox {
  // Dos envíos a la vez mandarían lo mismo dos veces: comparten uno solo.
  let pendingFlush: Promise<FlushSummary> | null = null;

  async function flushNow(client: ApiClient): Promise<FlushSummary> {
    // El servidor las aplica en el orden en que el chofer las hizo; sort es
    // estable, así que a igual hora queda el orden en que entraron a la cola.
    const pending = (await store.listOperations())
      .filter((op) => op.state === "PENDING")
      .sort((a, b) => a.envelope.clientTimestamp.localeCompare(b.envelope.clientTimestamp));
    const summary: FlushSummary = { sent: 0, inReview: 0, stillPending: pending.length };

    for (let start = 0; start < pending.length; start += MAX_OPERATIONS_PER_BATCH) {
      const body: SyncBatchBody = {
        operations: pending.slice(start, start + MAX_OPERATIONS_PER_BATCH).map((op) => op.envelope),
      };
      const { results } = await client.request<SyncBatchResult>("/sync/operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      for (const result of results) {
        const state = nextState(result);
        await store.setOperationState(result.id, state, result.reason ?? null);
        if (state === "SENT") summary.sent += 1;
        if (state === "IN_REVIEW") summary.inReview += 1;
        if (state !== "PENDING") summary.stillPending -= 1;
      }
    }
    return summary;
  }

  return {
    async enqueue(type, version, payload) {
      const envelope: SyncOperationEnvelope = {
        id: newId(),
        type,
        version,
        clientTimestamp: now().toISOString(),
        payload: payload as Record<string, unknown>,
      };
      await store.addOperation(envelope);
      return envelope;
    },
    flush(client) {
      pendingFlush ??= flushNow(client).finally(() => {
        pendingFlush = null;
      });
      return pendingFlush;
    },
  };
}
