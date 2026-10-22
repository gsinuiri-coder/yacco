import * as SecureStore from "expo-secure-store";

import type { TokenStore } from "./api-client";

/** La clave del refresh token en el almacenamiento seguro de Android (Keystore). */
export const REFRESH_TOKEN_KEY = "yacco.refreshToken";

/** El refresh de 30 días nunca queda en texto plano: va al almacenamiento cifrado del sistema. */
export const secureTokenStore: TokenStore = {
  read: () => SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
  write: (token) => SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token),
  clear: () => SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
};
