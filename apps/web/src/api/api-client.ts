import { ApiError, RequestTimeoutError, SessionExpiredError } from "./errors";
import { REQUEST_TIMEOUT_MS } from "./timing";
import type { AuthTokens, LoginRequest, RefreshResponse } from "./types";

export interface ApiClientDeps {
  baseUrl: string;
  getAccessToken: () => string | null;
  getRefreshToken: () => string | null;
  /** Persiste el access token renovado tras un refresh exitoso. */
  onAccessTokenRefreshed: (accessToken: string) => void;
  /** Limpia la sesión: ProtectedRoute se encarga de redirigir a /login. */
  onSessionExpired: () => void;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  /** login y refresh no llevan access token ni reintentan con refresh. */
  skipAuth?: boolean;
}

export interface ApiClient {
  request: <T>(path: string, options?: RequestOptions) => Promise<T>;
  login: (credentials: LoginRequest) => Promise<AuthTokens>;
  /** Canjea el refresh token por un access token nuevo. Lanza SessionExpiredError si ya no vale. */
  refreshAccessToken: () => Promise<string>;
}

export function createApiClient(deps: ApiClientDeps): ApiClient {
  async function send(path: string, options: RequestOptions, token: string | null) {
    const headers: Record<string, string> = {};
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    // AbortController en vez de AbortSignal.timeout para poder limpiar el
    // temporizador: en jsdom un timer vivo mantiene el test colgado.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      return await fetch(`${deps.baseUrl}${path}`, {
        method: options.method ?? "GET",
        headers,
        signal: controller.signal,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new RequestTimeoutError();
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * El refresh token viaja en el header Authorization, no en el cuerpo:
   * JwtRefreshStrategy lo extrae con ExtractJwt.fromAuthHeaderAsBearerToken().
   */
  async function refreshAccessToken(): Promise<string> {
    const refreshToken = deps.getRefreshToken();
    if (!refreshToken) {
      throw new SessionExpiredError();
    }

    const response = await send("/auth/refresh", { method: "POST", skipAuth: true }, refreshToken);
    if (!response.ok) {
      throw new SessionExpiredError();
    }

    const { accessToken } = (await response.json()) as RefreshResponse;
    return accessToken;
  }

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    let response = await send(path, options, options.skipAuth ? null : deps.getAccessToken());

    // Un solo reintento: si el segundo 401 llega, el problema no es un token
    // vencido y reintentar en bucle solo multiplicaría las peticiones.
    if (response.status === 401 && !options.skipAuth) {
      let accessToken: string;
      try {
        accessToken = await refreshAccessToken();
      } catch (error) {
        deps.onSessionExpired();
        throw error instanceof SessionExpiredError ? error : new SessionExpiredError();
      }

      deps.onAccessTokenRefreshed(accessToken);
      response = await send(path, options, accessToken);

      if (response.status === 401) {
        deps.onSessionExpired();
        throw new SessionExpiredError();
      }
    }

    if (!response.ok) {
      throw new ApiError(response.status, await readErrorMessage(response));
    }

    // 204 (e.g. DELETE) has no body; response.json() would throw trying to
    // parse an empty string as JSON.
    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  return {
    request,
    refreshAccessToken,
    login: (credentials) =>
      request<AuthTokens>("/auth/login", {
        method: "POST",
        body: credentials,
        skipAuth: true,
      }),
  };
}

/** Nest devuelve `{ message }` como string o como lista de errores de validación. */
async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string | string[] };
    if (Array.isArray(body.message)) {
      return body.message.join(", ");
    }
    return body.message ?? response.statusText;
  } catch {
    return response.statusText;
  }
}
