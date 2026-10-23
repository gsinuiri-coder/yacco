/**
 * El radio de «clientes cercanos» y de la venta en ruta (goal de la fila 11).
 * Lo usan el snapshot del chofer, para ofrecer los locales, y la operación de
 * venta en ruta, para aceptarlos: tiene que ser el mismo número en los dos.
 * Para la venta en ruta se mide desde las paradas de la ruta, nunca desde el
 * celular (decisión de Giancarlo, 2026-10-23).
 */
export const NEARBY_RADIUS_M = 1000;

const EARTH_RADIUS_M = 6_371_000;

export function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Haversine: la distancia sobre la Tierra, que a 1 km es exacta de sobra. */
export function distanceInMeters(
  fromLatitude: number,
  fromLongitude: number,
  toLatitude: number,
  toLongitude: number,
): number {
  const latitudeDelta = toRadians(toLatitude - fromLatitude);
  const longitudeDelta = toRadians(toLongitude - fromLongitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(fromLatitude)) *
      Math.cos(toRadians(toLatitude)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

const METERS_PER_DEGREE_LATITUDE = 111_320;

/**
 * La caja por grados que contiene el círculo de `NEARBY_RADIUS_M` alrededor
 * del punto: la base filtra con ella y la distancia de verdad decide después.
 */
export function nearbyBox(point: GeoPoint): {
  latitude: { gte: number; lte: number };
  longitude: { gte: number; lte: number };
} {
  const latitudeDelta = NEARBY_RADIUS_M / METERS_PER_DEGREE_LATITUDE;
  const longitudeDelta =
    NEARBY_RADIUS_M /
    (METERS_PER_DEGREE_LATITUDE * Math.max(Math.cos(toRadians(point.latitude)), 0.01));
  return {
    latitude: { gte: point.latitude - latitudeDelta, lte: point.latitude + latitudeDelta },
    longitude: { gte: point.longitude - longitudeDelta, lte: point.longitude + longitudeDelta },
  };
}

/** A `NEARBY_RADIUS_M` o menos de alguno de los puntos. */
export function isNearAny(point: GeoPoint, others: GeoPoint[]): boolean {
  return others.some(
    (other) =>
      distanceInMeters(point.latitude, point.longitude, other.latitude, other.longitude) <=
      NEARBY_RADIUS_M,
  );
}
