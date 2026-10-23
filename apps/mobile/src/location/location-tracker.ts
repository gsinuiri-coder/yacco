import type { MarkRouteStopBody } from "@yacco/shared";

/** Dónde estaba el celular al marcar la parada (#309); vacío si no se supo. */
export type MarkedPosition = Pick<
  MarkRouteStopBody,
  "markedLatitude" | "markedLongitude" | "markedAccuracyM"
>;

/**
 * La ubicación del celular, vista por las pantallas. En el celular es
 * expo-location con su tarea de fondo (expo-location-tracker.ts); en los
 * tests, uno de mentira.
 */
export interface LocationTracker {
  /**
   * Prende la ubicación en segundo plano —con la notificación fija que
   * Android exige— mientras la ruta está en curso, y la apaga cuando deja de
   * estarlo. Sin permiso no guarda nada y la ruta se trabaja igual.
   */
  follow(routeInProgress: boolean, intervalSeconds: number): Promise<void>;
  /** La apaga: al cerrar sesión. */
  stop(): Promise<void>;
  /** La posición de ahora, para la marca de la parada. Nunca la frena. */
  markedPosition(): Promise<MarkedPosition>;
  /** Avisa cada vez que la tarea de fondo dejó puntos en la cola. */
  onRecorded(listener: () => void): () => void;
}

/** Sin ubicación: lo que usan las pantallas si nadie les da una. */
export const NO_LOCATION_TRACKER: LocationTracker = {
  follow: async () => undefined,
  stop: async () => undefined,
  markedPosition: async () => ({}),
  onRecorded: () => () => undefined,
};
