import type { SessionUser } from "@yacco/shared";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { useSession } from "../session/SessionContext";
import { styles } from "../theme";

export function HomeScreen({ user }: { user: SessionUser | null }) {
  const { logout } = useSession();
  const [leaving, setLeaving] = useState(false);

  return (
    <View style={styles.screen}>
      <Text style={styles.title} accessibilityRole="header">
        {user === null ? "Hola" : `Hola, ${user.username}`}
      </Text>
      <Text style={styles.subtitle}>
        {user === null
          ? "Sin conexión. Tu sesión sigue abierta."
          : "Aquí vas a ver tu ruta del día."}
      </Text>

      <Pressable
        style={styles.secondaryButton}
        accessibilityRole="button"
        accessibilityState={{ disabled: leaving }}
        disabled={leaving}
        onPress={() => {
          setLeaving(true);
          void logout();
        }}
      >
        <Text style={styles.secondaryButtonText}>Cerrar sesión</Text>
      </Pressable>
    </View>
  );
}
