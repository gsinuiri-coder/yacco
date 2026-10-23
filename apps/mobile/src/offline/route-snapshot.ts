import type { RouteSnapshot } from "@yacco/shared";

import { ApiError, OfflineError, type ApiClient } from "../session/api-client";
import type { OfflineStore } from "./offline-store";

export interface Position {
  latitude: string;
  longitude: string;
}

export interface LoadedSnapshot {
  snapshot: RouteSnapshot | null;
  /** La ruta es la guardada en el celular: no hubo señal para bajarla de nuevo. */
  fromDevice: boolean;
}

/**
 * Con señal baja la ruta del día y la guarda; sin señal, abre la última que
 * quedó en el celular. Con la posición, la venta en ruta suma los locales a
 * menos de 1 km.
 */
export async function loadRouteSnapshot(
  client: ApiClient,
  store: OfflineStore,
  position?: Position,
): Promise<LoadedSnapshot> {
  const query = position
    ? `?${new URLSearchParams({ latitude: position.latitude, longitude: position.longitude })}`
    : "";
  try {
    const snapshot = await client.request<RouteSnapshot>(`/sync/route-snapshot${query}`);
    await store.saveSnapshot(snapshot);
    return { snapshot, fromDevice: false };
  } catch (error) {
    // Sin señal o con el servidor caído vale la copia del celular. Un 404 (no
    // tiene ruta hoy) o un 403 sí sube: esa respuesta es del servidor.
    const unreachable =
      error instanceof OfflineError || (error instanceof ApiError && error.status >= 500);
    if (!unreachable) throw error;
    return { snapshot: await store.loadSnapshot(), fromDevice: true };
  }
}
