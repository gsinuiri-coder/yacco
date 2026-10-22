import type { SessionUser } from "@yacco/shared";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { useSession } from "../session/SessionContext";
import { styles } from "../theme";

export function HomeScreen({ user }: { user: SessionUser | null }) {
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
    <View style={styles.screen}>
      <Text style={styles.title} accessibilityRole="header">
        {user === null ? "Hola" : `Hola, ${user.username}`}
      </Text>
      <Text style={styles.subtitle}>
        {user === null
          ? "Sin conexión con el servidor. Tu sesión sigue abierta."
          : "Aquí vas a ver tu ruta del día."}
      </Text>

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
    </View>
  );
}
