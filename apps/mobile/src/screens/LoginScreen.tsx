import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";

import { ApiError, OfflineError } from "../session/api-client";
import type { SessionEndReason } from "../session/api-client";
import { useSession } from "../session/SessionContext";
import { styles } from "../theme";

export const DRIVERS_ONLY_MESSAGE = "Solo choferes. La oficina entra por la web.";

const SESSION_ENDED_MESSAGES: Record<SessionEndReason, string> = {
  expired: "Tu sesión venció. Vuelve a ingresar.",
  driversOnly: DRIVERS_ONLY_MESSAGE,
};

function describeLoginFailure(error: unknown): string {
  if (error instanceof ApiError) {
    // Un 401 no dice si el usuario existe (la API responde lo mismo a
    // propósito), así que tampoco lo dice la pantalla.
    if (error.status === 401) return "Usuario o contraseña incorrectos.";
    if (error.status === 403) return DRIVERS_ONLY_MESSAGE;
    return error.message;
  }
  if (error instanceof OfflineError) return error.message;
  return "Algo falló al ingresar. Inténtalo de nuevo.";
}

export function LoginScreen({ ended }: { ended: SessionEndReason | null }) {
  const { login } = useSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(): Promise<void> {
    setErrorMessage(null);
    if (username.trim() === "" || password === "") {
      setErrorMessage("Ingresa usuario y contraseña.");
      return;
    }
    setSubmitting(true);
    try {
      await login({ username: username.trim(), password });
    } catch (error) {
      setErrorMessage(describeLoginFailure(error));
      setSubmitting(false);
    }
  }

  // El aviso de sesión terminada solo si terminó sola: nunca tras «Cerrar sesión».
  const notice = errorMessage ?? (ended === null ? null : SESSION_ENDED_MESSAGES[ended]);

  return (
    <View style={styles.screen}>
      <Text style={styles.title} accessibilityRole="header">
        Yacco
      </Text>
      <Text style={styles.subtitle}>Ingresa con el usuario que te dio la planta.</Text>

      <Text style={styles.label} nativeID="username-label">
        Usuario
      </Text>
      <TextInput
        style={styles.input}
        accessibilityLabelledBy="username-label"
        accessibilityLabel="Usuario"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username"
        value={username}
        onChangeText={setUsername}
        editable={!submitting}
      />

      <Text style={styles.label} nativeID="password-label">
        Contraseña
      </Text>
      <TextInput
        style={styles.input}
        accessibilityLabelledBy="password-label"
        accessibilityLabel="Contraseña"
        secureTextEntry
        autoComplete="password"
        value={password}
        onChangeText={setPassword}
        onSubmitEditing={() => void submit()}
        editable={!submitting}
      />

      {notice !== null && (
        <Text style={styles.alert} accessibilityRole="alert">
          {notice}
        </Text>
      )}

      <Pressable
        style={styles.button}
        accessibilityRole="button"
        accessibilityLabel="Ingresar"
        accessibilityState={{ disabled: submitting, busy: submitting }}
        disabled={submitting}
        onPress={() => void submit()}
      >
        {submitting ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={styles.buttonText}>Ingresar</Text>
        )}
      </Pressable>
    </View>
  );
}
