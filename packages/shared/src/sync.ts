/**
 * Sync contracts, derived from apps/api/src/modules/sync. The driver's app
 * queues every action as an operation and sends them in batches; the office
 * reviews the ones that ended in quarantine.
 */
import type { NamedReference } from "./container-balances.js";
import type { EffectivePrice } from "./customer-prices.js";
import type { PaymentMethod } from "./payments.js";
import type { ProductType } from "./products.js";
import type { Route, RouteTruckStockLine } from "./routes.js";

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

/** GET /sync/route-snapshot. Without `routeId`: the driver's route in progress, else today's. */
export interface RouteSnapshotQuery {
  routeId?: string;
  /** Where the phone is, so the van-sale list adds the locations within 1 km. */
  latitude?: string;
  longitude?: string;
}

export interface RouteSnapshotLocation {
  id: string;
  name: string;
  address: string;
  addressReference: string;
  phone: string;
  contactName: string | null;
  latitude: string | null;
  longitude: string | null;
  /** Has a stop on the route; otherwise it is offered for a van sale. */
  onRoute: boolean;
  customer: NamedReference;
  /** The customer's money debt, S/ as a 2-decimal string. */
  debtBalance: string;
  creditLimit: string | null;
  containerBalances: { containerType: NamedReference; quantity: number }[];
  loanedAccessories: { product: NamedReference; quantity: number }[];
  /** What applies to THIS location, same precedence as /effective-prices. */
  prices: EffectivePrice[];
}

export interface RouteSnapshotOrder {
  id: string;
  stopId: string;
  items: {
    product: NamedReference;
    productType: ProductType;
    quantity: number;
    unitPrice: string;
  }[];
}

/** Everything the driver's app stores to work the day without signal. */
export interface RouteSnapshot {
  generatedAt: string;
  route: Route;
  truckStock: RouteTruckStockLine[];
  locations: RouteSnapshotLocation[];
  orders: RouteSnapshotOrder[];
  products: {
    id: string;
    name: string;
    type: ProductType;
    containerType: NamedReference | null;
  }[];
  containerTypes: NamedReference[];
  paymentMethods: Pick<PaymentMethod, "id" | "name" | "requiresConfirmation">[];
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
