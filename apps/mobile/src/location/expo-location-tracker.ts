import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { PermissionsAndroid } from "react-native";

import type { OfflineStore } from "../offline/offline-store";
import type { LocationTracker, MarkedPosition } from "./location-tracker";
import { LOCATION_TASK_NAME, markedPositionOf, recordRouteLocations } from "./route-tracking";
import type { DeviceLocation } from "./route-tracking";

/** Lo mismo que espera «Mi ruta» de la web antes de marcar sin la posición. */
export const MARK_POSITION_TIMEOUT_MS = 10_000;

/** La tarea de fondo y las pantallas viven en el mismo proceso: así se avisan. */
const recordedListeners = new Set<() => void>();

async function stopUpdates(): Promise<void> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME)) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
    }
  } catch {
    // Sin el servicio de ubicación no hay nada que apagar.
  }
}

/**
 * Se llama al cargar la app (index.ts), fuera de toda pantalla: Android
 * despierta la tarea también con la app cerrada, y tiene que encontrarla
 * definida.
 */
export function defineRouteLocationTask(store: OfflineStore, newId: () => string): void {
  TaskManager.defineTask<{ locations: DeviceLocation[] }>(
    LOCATION_TASK_NAME,
    async ({ data, error }) => {
      if (error !== null || data === undefined) return;
      const outcome = await recordRouteLocations(store, data.locations, newId);
      if (outcome === "stop") {
        await stopUpdates();
        return;
      }
      for (const listener of recordedListeners) listener();
    },
  );
}

function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function startUpdates(intervalSeconds: number): Promise<void> {
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME)) return;
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== Location.PermissionStatus.GRANTED) return;
  const background = await Location.requestBackgroundPermissionsAsync();
  if (background.status !== Location.PermissionStatus.GRANTED) return;
  // Desde Android 13 la notificación fija solo se ve con este permiso. Sin él
  // la ubicación se guarda igual: la respuesta no cambia lo que sigue.
  await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(
    () => undefined,
  );

  const minutes = Math.round(intervalSeconds / 60);
  await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: intervalSeconds * 1000,
    distanceInterval: 0,
    deferredUpdatesInterval: intervalSeconds * 1000,
    foregroundService: {
      notificationTitle: "Ruta en curso",
      notificationBody:
        minutes <= 1
          ? "Yacco guarda tu ubicación cada minuto mientras tu ruta está en curso."
          : `Yacco guarda tu ubicación cada ${minutes} minutos mientras tu ruta está en curso.`,
      killServiceOnDestroy: false,
    },
  });
}

export function createExpoLocationTracker(): LocationTracker {
  return {
    async follow(routeInProgress, intervalSeconds) {
      try {
        await (routeInProgress ? startUpdates(intervalSeconds) : stopUpdates());
      } catch {
        // Sin permiso o sin GPS la ruta se trabaja igual; la oficina la ve
        // «sin señal».
      }
    },
    stop: stopUpdates,
    async markedPosition(): Promise<MarkedPosition> {
      try {
        const permission = await Location.getForegroundPermissionsAsync();
        if (permission.status !== Location.PermissionStatus.GRANTED) return {};
        const position = await within(
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
          MARK_POSITION_TIMEOUT_MS,
        );
        return position === null ? {} : markedPositionOf(position.coords);
      } catch {
        return {};
      }
    },
    onRecorded(listener) {
      recordedListeners.add(listener);
      return () => {
        recordedListeners.delete(listener);
      };
    },
  };
}
