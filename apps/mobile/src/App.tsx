import { ActivityIndicator, StatusBar, View } from "react-native";

import type { OfflineStore } from "./offline/offline-store";
import type { Outbox } from "./offline/outbox";
import { HomeScreen } from "./screens/HomeScreen";
import { LoginScreen } from "./screens/LoginScreen";
import type { ApiClient } from "./session/api-client";
import { SessionProvider, useSession } from "./session/SessionContext";
import { styles } from "./theme";

interface AppProps {
  client: ApiClient;
  offlineStore: OfflineStore;
  outbox: Outbox;
}

function CurrentScreen({ client, offlineStore, outbox }: AppProps) {
  const { state } = useSession();
  if (state.status === "restoring") {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" accessibilityLabel="Cargando" />
      </View>
    );
  }
  if (state.status === "signedOut") return <LoginScreen ended={state.ended} />;
  return (
    <HomeScreen user={state.user} client={client} offlineStore={offlineStore} outbox={outbox} />
  );
}

export function App(props: AppProps) {
  return (
    <SessionProvider client={props.client}>
      <StatusBar barStyle="dark-content" />
      <CurrentScreen {...props} />
    </SessionProvider>
  );
}
