export interface LocationCoordinates {
  latitude: string;
  longitude: string;
}

const COORDINATE_PAIR = /(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/g;
const MAPS_DATA_PAIR = /!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/g;

function fixedCoordinate(value: number): string {
  return (Object.is(value, -0) ? 0 : value).toFixed(6);
}

function coordinatesIfValid(latitude: string, longitude: string): LocationCoordinates | null {
  const latitudeNumber = Number(latitude);
  const longitudeNumber = Number(longitude);
  if (
    !Number.isFinite(latitudeNumber) ||
    !Number.isFinite(longitudeNumber) ||
    latitudeNumber < -90 ||
    latitudeNumber > 90 ||
    longitudeNumber < -180 ||
    longitudeNumber > 180
  ) {
    return null;
  }
  return {
    latitude: fixedCoordinate(latitudeNumber),
    longitude: fixedCoordinate(longitudeNumber),
  };
}

/** Extrae el primer par válido de un texto o de una URL larga de Google Maps. */
export function parseLocationCoordinates(input: string): LocationCoordinates | null {
  let decoded = input.trim();
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // El texto sin codificación sigue siendo una entrada válida para buscar.
  }

  for (const pattern of [MAPS_DATA_PAIR, COORDINATE_PAIR]) {
    pattern.lastIndex = 0;
    for (const match of decoded.matchAll(pattern)) {
      const coordinates = coordinatesIfValid(match[1]!, match[2]!);
      if (coordinates !== null) return coordinates;
    }
  }
  return null;
}

export function isGoogleMapsShortUrl(input: string): boolean {
  try {
    const url = new URL(input.trim());
    return url.protocol === "https:" && url.hostname === "maps.app.goo.gl";
  } catch {
    return false;
  }
}

function coordinateQuery(latitude: string, longitude: string): string {
  return encodeURIComponent(`${latitude},${longitude}`);
}

export function googleMapsLocationUrl(latitude: string, longitude: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${coordinateQuery(latitude, longitude)}`;
}

export function googleMapsDirectionsUrl(latitude: string, longitude: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${coordinateQuery(latitude, longitude)}`;
}
