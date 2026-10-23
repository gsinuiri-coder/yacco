import type { RouteSnapshot } from "@yacco/shared";

import { ApiError, OfflineError, type ApiClient } from "../session/api-client";
import type { OfflineStore } from "./offline-store";

export interface LoadedSnapshot {
  snapshot: RouteSnapshot | null;
  /** La ruta es la guardada en el celular: no hubo señal para bajarla de nuevo. */
  fromDevice: boolean;
}

/**
 * Con señal baja la ruta del día y la guarda; sin señal, abre la última que
 * quedó en el celular si es de este chofer. Cerrar sesión la borra, pero una
 * sesión vencida o cortada desde «Usuarios» la deja: la de otro no se abre.
 * Los locales para venta en ruta los acota el servidor con las paradas: el
 * celular no manda dónde está.
 */
export async function loadRouteSnapshot(
  client: ApiClient,
  store: OfflineStore,
  driverId: string,
): Promise<LoadedSnapshot> {
  try {
    const snapshot = await client.request<RouteSnapshot>("/sync/route-snapshot");
    await store.saveSnapshot(snapshot);
    return { snapshot, fromDevice: false };
  } catch (error) {
    // Sin señal o con el servidor caído vale la copia del celular. Un 404 (no
    // tiene ruta hoy) o un 403 sí sube: esa respuesta es del servidor.
    const unreachable =
      error instanceof OfflineError || (error instanceof ApiError && error.status >= 500);
    if (!unreachable) throw error;
    const saved = await store.loadSnapshot();
    return { snapshot: saved?.route.driverId === driverId ? saved : null, fromDevice: true };
  }
}
