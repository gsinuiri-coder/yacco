import type { StopStatus } from "@yacco/shared";

/** The plant map refreshes itself this often; points arrive every 5 minutes. */
export const MAP_REFRESH_MS = 60_000;

const MINUTE_MS = 60_000;

/**
 * «hace 3 minutos» from the phone's instant. A phone clock a little ahead
 * reads as «hace menos de un minuto», never as a negative.
 */
export function minutesAgoText(recordedAt: string, now: Date): string {
  const minutes = Math.floor((now.getTime() - new Date(recordedAt).getTime()) / MINUTE_MS);
  if (!Number.isFinite(minutes) || minutes < 1) return "hace menos de un minuto";
  if (minutes === 1) return "hace 1 minuto";
  if (minutes < 60) return `hace ${minutes} minutos`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `hace ${hours} h` : `hace ${hours} h ${rest} min`;
}

/**
 * Leaflet paints its circles with plain colors, not Nuxt UI tokens: the
 * same three meanings as the badges (success, error, warning).
 */
export const STOP_MARKER_COLOR: Record<StopStatus, string> = {
  DELIVERED: "#16a34a",
  FAILED: "#dc2626",
  PENDING: "#d97706",
};

export const PLANT_MARKER_COLOR = "#1d4ed8";
export const LIVE_MARKER_COLOR = "#0f766e";
export const NO_SIGNAL_MARKER_COLOR = "#6b7280";

export interface MapPoint {
  latitude: number;
  longitude: number;
}

/** The last point of a route in progress, as the map draws it. */
export interface LiveMarker {
  routeId: string;
  label: string;
  point: MapPoint;
  noSignal: boolean;
}

/** A stop of the chosen route that has coordinates. */
export interface StopMarker {
  id: string;
  label: string;
  point: MapPoint;
  status: StopStatus;
}

/** The API sends coordinates as decimal strings; Leaflet wants numbers. */
export function mapPoint(latitude: string | null, longitude: string | null): MapPoint | null {
  if (latitude === null || longitude === null) return null;
  const lat = Number(latitude);
  const lng = Number(longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { latitude: lat, longitude: lng } : null;
}
