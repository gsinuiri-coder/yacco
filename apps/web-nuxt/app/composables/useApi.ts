import type { HttpMethod, TransportRequest } from "../utils/api-transport";

export interface ApiRequestOptions {
  method?: HttpMethod;
  body?: unknown;
  query?: TransportRequest["query"];
}

/**
 * LA puerta a la API. Ninguna pantalla hace fetch por su cuenta: base URL,
 * token, refresh y errores se deciden acá, una vez.
 *
 * - Pone el access token vigente en cada petición.
 * - Ante un 401 renueva el token UNA vez y reintenta. Un segundo 401 no es un
 *   token vencido, y reintentar en bucle sólo multiplicaría peticiones.
 * - Si la sesión no se recupera, la cierra como vencida y lleva al login con
 *   la ruta actual para volver después.
 * - Un status fuera de 2xx sale como ApiError con el mensaje de Nest.
 *
 * Se llama sólo desde el cliente: la sesión no existe en el servidor (D-022).
 */
export function useApi() {
  const nuxtApp = useNuxtApp();
  const router = useRouter();
  const session = useSession();

  async function sessionLost(): Promise<never> {
    session.expire();
    // La ruta de AHORA (no la de cuando se creó el composable) y nunca una
    // pública: volver al login después del login anidaría ?from=/login?from=…
    const current = router.currentRoute.value;
    const query = current.meta.public ? {} : { from: current.fullPath };
    await nuxtApp.runWithContext(() => navigateTo({ path: "/login", query }));
    throw new SessionExpiredError();
  }

  async function request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
    let response = await sendToApi(path, { ...options, bearer: session.accessToken() });

    if (response.status === 401) {
      let renewed: string;
      try {
        renewed = await session.refreshAccessToken();
      } catch {
        return sessionLost();
      }
      response = await sendToApi(path, { ...options, bearer: renewed });
      if (response.status === 401) {
        return sessionLost();
      }
    }

    if (!isSuccess(response)) {
      throw errorFromResponse(response);
    }
    return response.data as T;
  }

  return { request };
}
