import { ActivityIndicator, StatusBar, View } from "react-native";

import type { OfflineStore } from "./offline/offline-store";
import { HomeScreen } from "./screens/HomeScreen";
import { LoginScreen } from "./screens/LoginScreen";
import type { ApiClient } from "./session/api-client";
import { SessionProvider, useSession } from "./session/SessionContext";
import { styles } from "./theme";

interface AppProps {
  client: ApiClient;
  offlineStore: OfflineStore;
}

function CurrentScreen({ client, offlineStore }: AppProps) {
  const { state } = useSession();
  if (state.status === "restoring") {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" accessibilityLabel="Cargando" />
      </View>
    );
  }
  if (state.status === "signedOut") return <LoginScreen ended={state.ended} />;
  return <HomeScreen user={state.user} client={client} offlineStore={offlineStore} />;
}

export function App({ client, offlineStore }: AppProps) {
  return (
    <SessionProvider client={client}>
      <StatusBar barStyle="dark-content" />
      <CurrentScreen client={client} offlineStore={offlineStore} />
    </SessionProvider>
  );
}
