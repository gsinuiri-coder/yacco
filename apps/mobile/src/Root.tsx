import { App } from "./App";
import { resolveApiUrl } from "./config";
import { createApiClient } from "./session/api-client";
import { secureTokenStore } from "./session/secure-token-store";

const client = createApiClient({
  baseUrl: resolveApiUrl(process.env.EXPO_PUBLIC_API_URL),
  store: secureTokenStore,
});

/** La app real: la API configurada y el refresh en el almacenamiento seguro. */
export function Root() {
  return <App client={client} />;
}
