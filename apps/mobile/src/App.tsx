import { useEffect } from "react";
import { ActivityIndicator, StatusBar, View } from "react-native";

import { NO_LOCATION_TRACKER, type LocationTracker } from "./location/location-tracker";
import type { OfflineStore } from "./offline/offline-store";
import { HomeScreen } from "./screens/HomeScreen";
import { LoginScreen } from "./screens/LoginScreen";
import type { ApiClient } from "./session/api-client";
import { SessionProvider, useSession } from "./session/SessionContext";
import { styles } from "./theme";

interface AppProps {
  client: ApiClient;
  offlineStore: OfflineStore;
  /** Genera el UUID de cada operación de la cola en el celular. */
  newOperationId: () => string;
  /** La ubicación del celular: en segundo plano y al marcar la parada. */
  locationTracker?: LocationTracker;
}

function CurrentScreen({
  client,
  offlineStore,
  newOperationId,
  locationTracker = NO_LOCATION_TRACKER,
}: AppProps) {
  const { state } = useSession();
  // Sin sesión no se sigue a nadie: la cerró el chofer, la cortó el
  // administrador desde «Usuarios» o venció. La ruta guardada puede quedar
  // (para el mismo chofer al volver), pero la notificación fija se va.
  const signedOut = state.status === "signedOut";
  useEffect(() => {
    if (signedOut) void locationTracker.stop();
  }, [signedOut, locationTracker]);

  if (state.status === "restoring") {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" accessibilityLabel="Cargando" />
      </View>
    );
  }
  if (state.status === "signedOut") return <LoginScreen ended={state.ended} />;
  return (
    // Una pantalla por chofer: su cola no se mezcla con la de otro.
    <HomeScreen
      key={state.driverId}
      user={state.user}
      driverId={state.driverId}
      client={client}
      offlineStore={offlineStore}
      newOperationId={newOperationId}
      locationTracker={locationTracker}
    />
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
