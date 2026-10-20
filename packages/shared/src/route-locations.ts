/**
 * One location sent by the driver's phone while the route is IN_PROGRESS.
 * `clientPointId` is generated on the phone: the same point sent twice is
 * stored once. Coordinates travel as decimal strings, like money.
 */
export interface RouteLocationPointInput {
  clientPointId: string;
  latitude: string;
  longitude: string;
  accuracyM?: string;
  /** ISO instant taken by the phone. */
  recordedAt: string;
}

/** POST /routes/:id/location-points */
export interface CreateRouteLocationPointsBody {
  points: RouteLocationPointInput[];
}

export interface RouteLocationPointsReceipt {
  received: number;
  stored: number;
}

/** GET /routes/:id/location-points (and the last point of a live route). */
export interface RouteLocationPoint {
  latitude: string;
  longitude: string;
  accuracyM: string | null;
  recordedAt: string;
  receivedAt: string;
  vehiclePlate: string | null;
}

export interface LiveRouteLocation {
  routeId: string;
  /** Calendar day "AAAA-MM-DD". */
  date: string;
  driverName: string;
  vehiclePlate: string | null;
  lastPoint: RouteLocationPoint | null;
  noSignal: boolean;
}

/** GET /route-locations/latest */
export interface LiveRouteLocations {
  staleAfterMinutes: number;
  routes: LiveRouteLocation[];
}
