import type { LoginRequest, MobileSession, RefreshResponse, SessionUser } from "@yacco/shared";

/** Las rutas de la API cuelgan todas de acá (configure-app.ts). */
export const API_PREFIX = "/api/v1";

/**
 * Dónde vive el refresh token de 30 días. En el celular es expo-secure-store
 * (secure-token-store.ts); en los tests, un objeto en memoria.
 */
export interface TokenStore {
  read(): Promise<string | null>;
  write(token: string): Promise<void>;
  clear(): Promise<void>;
}

/** La API respondió con un status fuera del rango 2xx. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** El refresh no vale más (venció, o el administrador cortó la sesión): hay que volver a ingresar. */
export class SessionExpiredError extends Error {
  constructor() {
    super("Tu sesión venció. Vuelve a ingresar.");
    this.name = "SessionExpiredError";
  }
}

/** El pedido ni llegó al servidor: sin señal, o el servidor no responde. */
export class OfflineError extends Error {
  constructor(cause: unknown) {
    super("No se pudo conectar con el servidor. Revisa tu señal e inténtalo de nuevo.", { cause });
    this.name = "OfflineError";
  }
}

export interface ApiClient {
  /** POST /auth/mobile/login: guarda el refresh en el almacenamiento seguro. */
  login(credentials: LoginRequest): Promise<void>;
  /** Hay un refresh guardado de una sesión anterior. */
  hasStoredSession(): Promise<boolean>;
  /** Un pedido con el token de acceso; ante un 401 renueva una vez y repite. */
  request<T>(path: string, init?: RequestInit): Promise<T>;
  /** GET /auth/me: quién es el chofer, según su token. */
  me(): Promise<SessionUser>;
  /** Borra el refresh del celular. */
  logout(): Promise<void>;
}

export interface ApiClientOptions {
  baseUrl: string;
  store: TokenStore;
  fetchImpl?: typeof fetch;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

async function toApiError(response: Response): Promise<ApiError> {
  let message = `El servidor respondió ${response.status}.`;
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === "string") message = body.message;
    else if (Array.isArray(body.message)) message = body.message.join(" ");
  } catch {
    // Sin cuerpo JSON: queda el mensaje con el status.
  }
  return new ApiError(response.status, message);
}

export function createApiClient({
  baseUrl,
  store,
  fetchImpl = fetch,
}: ApiClientOptions): ApiClient {
  // El de acceso vive solo en memoria: dura minutos y se renueva con el refresh.
  let accessToken: string | null = null;
  // Dos pedidos que reciben 401 a la vez comparten una sola renovación.
  let pendingRefresh: Promise<void> | null = null;

  async function send(path: string, init: RequestInit): Promise<Response> {
    try {
      return await fetchImpl(`${baseUrl}${API_PREFIX}${path}`, init);
    } catch (error) {
      throw new OfflineError(error);
    }
  }

  async function refreshNow(): Promise<void> {
    const refreshToken = await store.read();
    if (!refreshToken) throw new SessionExpiredError();
    const response = await send("/auth/mobile/refresh", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ refreshToken }),
    });
    // 401: vencido, revocado desde «Usuarios» o ya sin rol de chofer. El
    // refresh guardado no sirve más y no se vuelve a intentar con él.
    if (response.status === 401) {
      accessToken = null;
      await store.clear();
      throw new SessionExpiredError();
    }
    if (!response.ok) throw await toApiError(response);
    accessToken = ((await response.json()) as RefreshResponse).accessToken;
  }

  function refresh(): Promise<void> {
    pendingRefresh ??= refreshNow().finally(() => {
      pendingRefresh = null;
    });
    return pendingRefresh;
  }

  function authorized(init: RequestInit): RequestInit {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${accessToken}`);
    return { ...init, headers };
  }

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (accessToken === null) await refresh();
    let response = await send(path, authorized(init));
    if (response.status === 401) {
      await refresh();
      response = await send(path, authorized(init));
    }
    if (!response.ok) throw await toApiError(response);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  return {
    async login(credentials) {
      const response = await send("/auth/mobile/login", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(credentials),
      });
      if (!response.ok) throw await toApiError(response);
      const session = (await response.json()) as MobileSession;
      await store.write(session.refreshToken);
      accessToken = session.accessToken;
    },
    async hasStoredSession() {
      return (await store.read()) !== null;
    },
    request,
    me() {
      return request<SessionUser>("/auth/me");
    },
    async logout() {
      accessToken = null;
      await store.clear();
    },
  };
}
