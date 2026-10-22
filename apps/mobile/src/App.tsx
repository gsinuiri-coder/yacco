import { ActivityIndicator, StatusBar, View } from "react-native";

import { HomeScreen } from "./screens/HomeScreen";
import { LoginScreen } from "./screens/LoginScreen";
import type { ApiClient } from "./session/api-client";
import { SessionProvider, useSession } from "./session/SessionContext";
import { styles } from "./theme";

function CurrentScreen() {
  const { state } = useSession();
  if (state.status === "restoring") {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" accessibilityLabel="Cargando" />
      </View>
    );
  }
  if (state.status === "signedOut") return <LoginScreen expired={state.expired} />;
  return <HomeScreen user={state.user} />;
}

export function App({ client }: { client: ApiClient }) {
  return (
    <SessionProvider client={client}>
      <StatusBar barStyle="dark-content" />
      <CurrentScreen />
    </SessionProvider>
  );
}
