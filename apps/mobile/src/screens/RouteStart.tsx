import type { RouteStatus } from "@yacco/shared";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { QUEUED_OPERATION_STATE_LABELS, type QueuedOperation } from "../offline/offline-store";
import { styles } from "../theme";

/** Las mismas palabras que la web (route-status.ts). */
export const ROUTE_STATUS_LABELS: Record<RouteStatus, string> = {
  PLANNED: "Ruta planificada",
  IN_PROGRESS: "Ruta en curso",
  FINISHED: "Ruta terminada",
  SETTLED: "Ruta liquidada",
};

interface RouteStartProps {
  status: RouteStatus;
  /** El «Empezar la ruta» que hizo el celular, si lo hizo. */
  queued: QueuedOperation | null;
  onStart: () => Promise<void>;
}

/**
 * Empezar la ruta desde el celular, también sin señal (decisión de Giancarlo,
 * 2026-10-23): entra a la cola como `ROUTE_START` y desde ahí ya se marcan
 * paradas. Si choca con la oficina, gana el servidor, igual que una parada.
 */
export function RouteStart({ status, queued, onStart }: RouteStartProps) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (queued !== null) {
    const shown = queued.state === "IN_REVIEW" ? status : "IN_PROGRESS";
    return (
      <View style={styles.card}>
        <Text style={styles.label}>
          {ROUTE_STATUS_LABELS[shown]} · {QUEUED_OPERATION_STATE_LABELS[queued.state]}
        </Text>
        {queued.state === "IN_REVIEW" && queued.reason !== null && <Text>{queued.reason}</Text>}
      </View>
    );
  }
  if (status !== "PLANNED") return null;

  async function start(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      await onStart();
    } catch {
      setError("No se pudo guardar en el celular. Inténtalo de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.card}>
      {error !== null && (
        <Text style={styles.alert} accessibilityRole="alert">
          {error}
        </Text>
      )}
      <Pressable
        style={styles.button}
        accessibilityRole="button"
        accessibilityState={{ disabled: saving }}
        disabled={saving}
        onPress={() => void start()}
      >
        <Text style={styles.buttonText}>Empezar la ruta</Text>
      </Pressable>
    </View>
  );
}
