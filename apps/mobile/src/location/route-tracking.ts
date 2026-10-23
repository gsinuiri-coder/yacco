import { positionStrings } from "@yacco/shared";
import type { PositionReading, RouteLocationPointPayloadV1 } from "@yacco/shared";

import type { OfflineStore } from "../offline/offline-store";
import { createOutbox } from "../offline/outbox";
import { shouldFollowRoute } from "../offline/route-progress";
import type { MarkedPosition } from "./location-tracker";

/** El nombre con que Android despierta la tarea de fondo. */
export const LOCATION_TASK_NAME = "yacco-route-location";

/**
 * Cada 5 minutos (Fase 3, fila 10): lo que vale si la ruta guardada es de una
 * versión de la app que todavía no traía la configuración del servidor.
 */
export const DEFAULT_LOCATION_INTERVAL_SECONDS = 300;

/** Una lectura del celular: la forma de `LocationObject` de expo-location. */
export interface DeviceLocation {
  coords: PositionReading;
  /** Milisegundos desde 1970, la hora del celular al tomarla. */
  timestamp: number;
}

export function markedPositionOf(coords: PositionReading): MarkedPosition {
  const strings = positionStrings(coords);
  if (strings === null) return {};
  return {
    markedLatitude: strings.latitude,
    markedLongitude: strings.longitude,
    markedAccuracyM: strings.accuracyM,
  };
}

export type RecordOutcome = "recorded" | "stop";

/**
 * Lo que hace la tarea de fondo con cada tanda de lecturas: las deja en la
 * cola como `ROUTE_LOCATION_POINT`, a nombre del chofer de la ruta guardada.
 * Sin ruta guardada (cerró sesión) o con la ruta que ya no está en curso, no
 * guarda nada y pide apagarse: Android puede despertarla con la app cerrada y
 * nadie más la apagaría.
 *
 * Dos horas distintas: la del punto (`recordedAt`) es la del GPS, la del
 * sobre es el reloj del celular, el mismo de «Empezar la ruta» y las marcas.
 * La cola se ordena por la del sobre: con la del GPS, un reloj adelantado
 * pondría los primeros puntos antes de empezar la ruta y el servidor los
 * rechazaría.
 */
export async function recordRouteLocations(
  store: OfflineStore,
  locations: DeviceLocation[],
  newId: () => string,
  now: () => Date = () => new Date(),
): Promise<RecordOutcome> {
  const snapshot = await store.loadSnapshot();
  if (snapshot === null) return "stop";
  const { route } = snapshot;
  if (!shouldFollowRoute(route, await store.listOperations(route.driverId))) return "stop";

  const outbox = createOutbox({ store, driverId: route.driverId, newId, now });
  for (const location of locations) {
    const strings = positionStrings(location.coords);
    if (strings === null) continue;
    const payload: RouteLocationPointPayloadV1 = {
      routeId: route.id,
      clientPointId: newId(),
      ...strings,
      recordedAt: new Date(location.timestamp).toISOString(),
    };
    await outbox.enqueue("ROUTE_LOCATION_POINT", 1, payload);
  }
  return "recorded";
}
