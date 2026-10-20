/** What the API accepts for a coordinate: decimal strings, like money. */
export interface PositionStrings {
  latitude: string;
  longitude: string;
  accuracyM: string;
}

/**
 * The phone's reading as the API takes it, or null if it is not one the API
 * would accept (out of range or not a number). Six decimals is what
 * NUMERIC(9,6) keeps; the precision fits NUMERIC(10,2).
 */
export function positionStrings(coords: GeolocationCoordinates): PositionStrings | null {
  const { latitude, longitude, accuracy } = coords;
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    !Number.isFinite(accuracy) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180 ||
    accuracy < 0 ||
    accuracy > 99_999_999.99
  ) {
    return null;
  }
  return {
    latitude: latitude.toFixed(6),
    longitude: longitude.toFixed(6),
    accuracyM: accuracy.toFixed(2),
  };
}
