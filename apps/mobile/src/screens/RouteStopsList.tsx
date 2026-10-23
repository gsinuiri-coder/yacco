import type { RouteSnapshot, StopStatus } from "@yacco/shared";
import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import type { OfflineStore } from "../offline/offline-store";
import { loadRouteSnapshot } from "../offline/route-snapshot";
import { ApiError, type ApiClient } from "../session/api-client";
import { styles } from "../theme";

/** Las mismas palabras que la web (route-status.ts). */
export const STOP_STATUS_LABELS: Record<StopStatus, string> = {
  PENDING: "Pendiente",
  DELIVERED: "Entregada",
  FAILED: "No entregada",
};

type Loaded =
  | { status: "loading" }
  | { status: "ready"; snapshot: RouteSnapshot | null; fromDevice: boolean }
  | { status: "failed"; message: string };

/**
 * Las paradas de la ruta del día. Con señal las baja del servidor y las deja
 * guardadas; sin señal muestra las que quedaron en el celular.
 */
export function RouteStopsList({ client, store }: { client: ApiClient; store: OfflineStore }) {
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });

  useEffect(() => {
    let active = true;
    loadRouteSnapshot(client, store).then(
      ({ snapshot, fromDevice }) => {
        if (active) setLoaded({ status: "ready", snapshot, fromDevice });
      },
      (error: unknown) => {
        if (!active) return;
        const message =
          error instanceof ApiError
            ? error.message
            : "No se pudo abrir la ruta. Inténtalo de nuevo.";
        setLoaded({ status: "failed", message });
      },
    );
    return () => {
      active = false;
    };
  }, [client, store]);

  if (loaded.status === "loading") {
    return <ActivityIndicator size="large" accessibilityLabel="Cargando la ruta" />;
  }
  if (loaded.status === "failed") {
    return (
      <Text style={styles.alert} accessibilityRole="alert">
        {loaded.message}
      </Text>
    );
  }
  if (loaded.snapshot === null) {
    return (
      <Text style={styles.subtitle}>
        Sin señal y sin una ruta guardada en el celular. Conéctate para bajar tu ruta.
      </Text>
    );
  }

  const { route } = loaded.snapshot;
  return (
    <View>
      {loaded.fromDevice && (
        <Text style={styles.notice}>Sin señal: es la ruta guardada en el celular.</Text>
      )}
      {route.stops.length === 0 && <Text style={styles.subtitle}>Tu ruta no tiene paradas.</Text>}
      {route.stops.map((stop) => (
        <View key={stop.id} style={styles.card} accessibilityLabel={`Parada ${stop.position}`}>
          <Text style={styles.label}>
            {stop.position}. {stop.location.name}
          </Text>
          <Text>{stop.location.customer.name}</Text>
          <Text>{stop.location.address}</Text>
          <Text>
            {STOP_STATUS_LABELS[stop.status]}
            {stop.origin === "VAN_SALE" ? " · Venta en ruta" : ""}
          </Text>
        </View>
      ))}
    </View>
  );
}
