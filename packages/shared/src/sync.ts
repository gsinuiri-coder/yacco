/**
 * Sync contracts, derived from apps/api/src/modules/sync. The driver's app
 * queues every action as an operation and sends them in batches; the office
 * reviews the ones that ended in quarantine.
 */

/** Operation types the API knows. A new shape is a new `version`, never an edit. */
export type SyncOperationType = "STOP_MARK";

/** One queued action. `id` is generated on the phone; `clientTimestamp` is the phone's clock. */
export interface SyncOperationEnvelope<TPayload = Record<string, unknown>> {
  id: string;
  type: SyncOperationType;
  version: number;
  clientTimestamp: string;
  payload: TPayload;
}

/** POST /sync/operations */
export interface SyncBatchBody {
  operations: SyncOperationEnvelope[];
}

export type SyncResultStatus = "APPLIED" | "DUPLICATE" | "REJECTED";

/**
 * REJECTED with `quarantined: false` gets one more attempt: the phone keeps it
 * queued. With `quarantined: true` the office reviews it.
 */
export interface SyncOperationResult {
  id: string;
  status: SyncResultStatus;
  quarantined: boolean;
  reason?: string;
}

export interface SyncBatchResult {
  results: SyncOperationResult[];
}

export interface SyncOperationStopContext {
  routeId: string;
  /** Calendar day "AAAA-MM-DD". */
  routeDate: string;
  stopId: string;
  customerName: string;
  locationName: string;
  /** The stop's status on the server today. */
  stopStatus: string;
}

/** GET /sync/operations/in-review */
export interface SyncOperationInReview {
  id: string;
  type: string;
  version: number;
  payload: unknown;
  driverName: string;
  clientTimestamp: string;
  receivedAt: string;
  quarantinedAt: string;
  attempts: number;
  rejectionReason: string;
  stop?: SyncOperationStopContext;
}

/** PATCH /sync/operations/:id/resolution */
export interface ResolveSyncOperationBody {
  note: string;
}

export interface SyncOperationResolution {
  id: string;
  resolvedAt: string;
  resolutionNote: string;
}
