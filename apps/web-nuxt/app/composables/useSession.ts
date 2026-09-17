import type {
  LoginRequest,
  AuthTokens,
  RefreshResponse,
  UserRole,
  SessionUser,
} from "@yacco/shared";

/**
 * La sesión vive en el CLIENTE, como en el web React: access token en
 * memoria, refresh token en localStorage (D-022). Por eso el servidor nunca
 * sabe quién está conectado y los datos autenticados se piden desde el
 * navegador; el SSR sirve el shell, el login y lo público. No es un descuido:
 * mover la sesión a una cookie httpOnly es la fase que habilita SSR de datos
 * autenticados, y queda fuera de esta migración porque toca auth de producción.
 */

interface SessionInternals {
  /** Sólo en memoria: un XSS no lo encuentra en disco y se pierde al recargar. */
  accessToken: string | null;
  restoring: Promise<void> | null;
  /** Varias peticiones con 401 a la vez comparten UN refresh. */
  refreshing: Promise<string> | null;
}

// Por instancia de app, nunca en useState: useState termina en el payload.
const internalsByApp = new WeakMap<object, SessionInternals>();

function internalsOf(app: object): SessionInternals {
  let internals = internalsByApp.get(app);
  if (internals === undefined) {
    internals = { accessToken: null, restoring: null, refreshing: null };
    internalsByApp.set(app, internals);
  }
  return internals;
}

export function useSession() {
  const nuxtApp = useNuxtApp();
  const internals = internalsOf(nuxtApp);
  const user = useState<SessionUser | null>("session:user", () => null);
  /** True sólo si la sesión terminó por vencer; un "Cerrar sesión" a propósito no avisa nada. */
  const expired = useState<boolean>("session:expired", () => false);

  function applyAccessToken(token: string | null): void {
    internals.accessToken = token;
    user.value = token === null ? null : readSessionUser(token);
  }

  function end(reason: "expired" | "manual"): void {
    refreshTokenStore.clear();
    applyAccessToken(null);
    expired.value = reason === "expired";
  }

  /** Canjea el refresh token guardado por un access token nuevo. Lanza SessionExpiredError si ya no vale. */
  function refreshAccessToken(): Promise<string> {
    internals.refreshing ??= (async () => {
      const refreshToken = refreshTokenStore.read();
      if (refreshToken === null) throw new SessionExpiredError();
      // El refresh token viaja en Authorization: JwtRefreshStrategy lo lee de ahí.
      const response = await sendToApi("/auth/refresh", { method: "POST", bearer: refreshToken });
      if (!isSuccess(response)) throw new SessionExpiredError();
      const { accessToken } = response.data as RefreshResponse;
      applyAccessToken(accessToken);
      return accessToken;
    })().finally(() => {
      internals.refreshing = null;
    });
    return internals.refreshing;
  }

  /**
   * Al recargar, el access token en memoria se perdió: si hay refresh token en
   * disco se canjea antes de decidir si hay sesión. Con sesión, o sin nada que
   * canjear, no hace nada; si falla, borra el refresh token, así que el
   * middleware puede llamarla en cada navegación sin repetir un canje perdido.
   */
  function restore(): Promise<void> {
    if (user.value !== null || refreshTokenStore.read() === null) {
      return Promise.resolve();
    }
    internals.restoring ??= refreshAccessToken()
      .then(() => undefined)
      .catch(() => {
        // El caso típico: la laptop quedó toda la noche y el refresh venció.
        end("expired");
      })
      .finally(() => {
        internals.restoring = null;
      });
    return internals.restoring;
  }

  async function login(credentials: LoginRequest): Promise<void> {
    const response = await sendToApi("/auth/login", { method: "POST", body: credentials });
    if (!isSuccess(response)) throw errorFromResponse(response);
    const tokens = response.data as AuthTokens;
    refreshTokenStore.write(tokens.refreshToken);
    applyAccessToken(tokens.accessToken);
    expired.value = false;
  }

  async function logout(): Promise<void> {
    end("manual");
    await nuxtApp.runWithContext(() => navigateTo("/login"));
  }

  function hasRole(role: UserRole): boolean {
    return user.value?.roles.includes(role) ?? false;
  }

  return {
    user: readonly(user),
    expired: readonly(expired),
    accessToken: () => internals.accessToken,
    restore,
    refreshAccessToken,
    login,
    logout,
    expire: () => end("expired"),
    hasRole,
  };
}
