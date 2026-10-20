/** Public, non-secret coordinates used as the origin of planned routes. */
export interface PlantLocation {
  latitude: string | null;
  longitude: string | null;
}

/** GET /settings/location-tracking: how often the phone sends its location. */
export interface LocationTracking {
  intervalSeconds: number;
}
