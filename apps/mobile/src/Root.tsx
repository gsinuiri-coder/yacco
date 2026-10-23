import { openDatabaseAsync } from "expo-sqlite";
import { useState } from "react";
import { Text, View } from "react-native";

import { App } from "./App";
import { resolveApiUrl } from "./config";
import { lazyOfflineStore } from "./offline/lazy-offline-store";
import type { OfflineStore } from "./offline/offline-store";
import { OFFLINE_DATABASE_NAME, createSqliteOfflineStore } from "./offline/sqlite-offline-store";
import { createApiClient } from "./session/api-client";
import type { ApiClient } from "./session/api-client";
import { secureTokenStore } from "./session/secure-token-store";
import { styles } from "./theme";

export function buildClient(configuredUrl: string | undefined): ApiClient | null {
  const baseUrl = resolveApiUrl(configuredUrl);
  return baseUrl === null ? null : createApiClient({ baseUrl, store: secureTokenStore });
}

/** La ruta y la cola del chofer, en el SQLite del celular. */
export function buildOfflineStore(): OfflineStore {
  return lazyOfflineStore(async () =>
    createSqliteOfflineStore(await openDatabaseAsync(OFFLINE_DATABASE_NAME)),
  );
}

/** Lo que ve el chofer si el APK se armó sin la dirección del servidor. */
export function MissingServer() {
  return (
    <View style={styles.screen}>
      <Text style={styles.title} accessibilityRole="header">
        Falta la dirección del servidor
      </Text>
      <Text style={styles.subtitle}>
        Esta copia de la app no sabe a qué servidor conectarse. Pide en la oficina que te instalen
        la versión correcta.
      </Text>
    </View>
  );
}

/**
 * La app real: la API configurada y el refresh en el almacenamiento seguro.
 * `process.env.EXPO_PUBLIC_API_URL` escrito tal cual: Expo solo inlinea la
 * variable cuando el acceso es literal.
 */
export function Root({ apiUrl = process.env.EXPO_PUBLIC_API_URL }: { apiUrl?: string }) {
  // Un solo cliente por vida de la app: guarda el token de acceso en memoria.
  const [client] = useState(() => buildClient(apiUrl));
  const [offlineStore] = useState(buildOfflineStore);
  return client === null ? <MissingServer /> : <App client={client} offlineStore={offlineStore} />;
}
