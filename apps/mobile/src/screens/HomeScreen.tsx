import type { SessionUser } from "@yacco/shared";
import { useState } from "react";
import { Pressable, ScrollView, Text } from "react-native";

import type { OfflineStore } from "../offline/offline-store";
import type { ApiClient } from "../session/api-client";
import { useSession } from "../session/SessionContext";
import { styles } from "../theme";
import { RouteStopsList } from "./RouteStopsList";

interface HomeScreenProps {
  user: SessionUser | null;
  client: ApiClient;
  offlineStore: OfflineStore;
}

export function HomeScreen({ user, client, offlineStore }: HomeScreenProps) {
  const { logout } = useSession();
  const [leaving, setLeaving] = useState(false);
  const [failed, setFailed] = useState(false);

  async function leave(): Promise<void> {
    setLeaving(true);
    setFailed(false);
    try {
      await logout();
    } catch {
      // El almacenamiento seguro no borró el refresh: la sesión sigue abierta.
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

      <RouteStopsList client={client} store={offlineStore} />

      {failed && (
        <Text style={styles.alert} accessibilityRole="alert">
          No se pudo cerrar la sesión. Inténtalo de nuevo.
        </Text>
      )}

      <Pressable
        style={styles.secondaryButton}
        accessibilityRole="button"
        accessibilityState={{ disabled: leaving }}
        disabled={leaving}
        onPress={() => void leave()}
      >
        <Text style={styles.secondaryButtonText}>Cerrar sesión</Text>
      </Pressable>
    </ScrollView>
  );
}
