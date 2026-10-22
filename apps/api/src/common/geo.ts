/**
 * El radio de «clientes cercanos» y de la venta en ruta (goal de la fila 11).
 * Lo usan el snapshot del chofer, para ofrecer los locales, y la operación de
 * venta en ruta, para aceptarlos: tiene que ser el mismo número en los dos.
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
