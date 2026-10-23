import type { RouteSnapshot, StopMarkPayloadV1 } from "@yacco/shared";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import type { OfflineStore, QueuedOperation } from "../offline/offline-store";
import type { Outbox } from "../offline/outbox";
import { loadRouteSnapshot } from "../offline/route-snapshot";
import { ApiError, type ApiClient } from "../session/api-client";
import { styles } from "../theme";
import { StopCard } from "./StopCard";

type Loaded =
  | { status: "loading" }
  | { status: "ready"; snapshot: RouteSnapshot | null; fromDevice: boolean }
  | { status: "failed"; message: string };

interface RouteStopsListProps {
  client: ApiClient;
  store: OfflineStore;
  outbox: Outbox;
}

/** La última marca que el celular hizo de cada parada: la cola está en el orden en que se hizo. */
function lastMarkByStop(operations: QueuedOperation[]): Map<string, QueuedOperation> {
  const byStop = new Map<string, QueuedOperation>();
  for (const op of operations) {
    if (op.envelope.type !== "STOP_MARK") continue;
    byStop.set((op.envelope.payload as unknown as StopMarkPayloadV1).stopId, op);
  }
  return byStop;
}

/**
 * Las paradas de la ruta del día. Con señal las baja del servidor y las deja
 * guardadas; sin señal muestra las que quedaron en el celular. Lo que el
 * chofer marca entra a la cola y sale cuando hay señal.
 */
export function RouteStopsList({ client, store, outbox }: RouteStopsListProps) {
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const [operations, setOperations] = useState<QueuedOperation[]>([]);

  const send = useCallback(async () => {
    try {
      await outbox.flush(client);
    } catch {
      // Sin señal o con el servidor caído: lo que no llegó sigue pendiente.
    }
    setOperations(await store.listOperations());
  }, [client, store, outbox]);

  useEffect(() => {
    let active = true;
    loadRouteSnapshot(client, store).then(
      async ({ snapshot, fromDevice }) => {
        const queued = await store.listOperations();
        if (!active) return;
        setOperations(queued);
        setLoaded({ status: "ready", snapshot, fromDevice });
        await send();
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
  }, [client, store, send]);

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
  const marks = lastMarkByStop(operations);

  async function fail(stopId: string, failureReason: string): Promise<void> {
    const payload: StopMarkPayloadV1 = {
      routeId: route.id,
      stopId,
      status: "FAILED",
      failureReason,
    };
    await outbox.enqueue("STOP_MARK", 1, payload);
    setOperations(await store.listOperations());
    void send();
  }

  return (
    <View>
      {loaded.fromDevice && (
        <Text style={styles.notice}>Sin señal: es la ruta guardada en el celular.</Text>
      )}
      {route.stops.length === 0 && <Text style={styles.subtitle}>Tu ruta no tiene paradas.</Text>}
      {route.stops.map((stop) => (
        <StopCard
          key={stop.id}
          stop={stop}
          queued={marks.get(stop.id) ?? null}
          canMark={route.status === "IN_PROGRESS"}
          onFail={(reason) => fail(stop.id, reason)}
        />
      ))}
    </View>
  );
}
