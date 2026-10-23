import type { SessionUser } from "@yacco/shared";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import type { OfflineStore } from "../offline/offline-store";
import { createOutbox } from "../offline/outbox";
import type { ApiClient } from "../session/api-client";
import { useSession } from "../session/SessionContext";
import { styles } from "../theme";
import { RouteStopsList } from "./RouteStopsList";

interface HomeScreenProps {
  user: SessionUser | null;
  /** El chofer de la sesión: la cola que se ve y se envía es la suya. */
  driverId: string;
  client: ApiClient;
  offlineStore: OfflineStore;
  newOperationId: () => string;
}

/** Lo que le queda por enviar, dicho antes de cerrar sesión. */
export function pendingWarning(count: number): string {
  const what = count === 1 ? "1 pendiente de enviar" : `${count} pendientes de enviar`;
  const when = count === 1 ? "se enviará" : "se enviarán";
  return `Tienes ${what}; ${when} cuando vuelvas a entrar. ¿Cerrar sesión igual?`;
}

export function HomeScreen({
  user,
  driverId,
  client,
  offlineStore,
  newOperationId,
}: HomeScreenProps) {
  const { logout } = useSession();
  const [outbox] = useState(() =>
    createOutbox({ store: offlineStore, driverId, newId: newOperationId }),
  );
  const [leaving, setLeaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pendingToConfirm, setPendingToConfirm] = useState<number | null>(null);

  /**
   * Cerrar sesión borra la ruta guardada; la cola NUNCA (decisión de
   * Giancarlo, 2026-10-23): queda a su nombre y sale cuando vuelve a entrar.
   * Con algo sin enviar, primero avisa cuánto y deja seguir.
   */
  async function leave(confirmed: boolean): Promise<void> {
    setLeaving(true);
    setFailed(false);
    try {
      if (!confirmed) {
        const pending = (await outbox.list()).filter((op) => op.state === "PENDING").length;
        if (pending > 0) {
          setPendingToConfirm(pending);
          setLeaving(false);
          return;
        }
      }
      await offlineStore.clearSnapshot();
      await logout();
    } catch {
      // La base del celular o el almacenamiento seguro fallaron: la sesión
      // sigue abierta y se puede intentar de nuevo.
      setPendingToConfirm(null);
      setFailed(true);
      setLeaving(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.scrollScreen}>
      <Text style={styles.title} accessibilityRole="header">
        {user === null ? "Hola" : `Hola, ${user.username}`}
      </Text>
      {user === null && (
        <Text style={styles.subtitle}>Sin conexión con el servidor. Tu sesión sigue abierta.</Text>
      )}

      <RouteStopsList client={client} store={offlineStore} outbox={outbox} driverId={driverId} />

      {failed && (
        <Text style={styles.alert} accessibilityRole="alert">
          No se pudo cerrar la sesión. Inténtalo de nuevo.
        </Text>
      )}

      {pendingToConfirm === null ? (
        <Pressable
          style={styles.secondaryButton}
          accessibilityRole="button"
          accessibilityState={{ disabled: leaving }}
          disabled={leaving}
          onPress={() => void leave(false)}
        >
          <Text style={styles.secondaryButtonText}>Cerrar sesión</Text>
        </Pressable>
      ) : (
        <View style={styles.card}>
          <Text style={styles.notice}>{pendingWarning(pendingToConfirm)}</Text>
          <Pressable
            style={styles.button}
            accessibilityRole="button"
            accessibilityState={{ disabled: leaving }}
            disabled={leaving}
            onPress={() => void leave(true)}
          >
            <Text style={styles.buttonText}>Cerrar sesión igual</Text>
          </Pressable>
          <Pressable
            style={styles.secondaryButton}
            accessibilityRole="button"
            onPress={() => setPendingToConfirm(null)}
          >
            <Text style={styles.secondaryButtonText}>Cancelar</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}
