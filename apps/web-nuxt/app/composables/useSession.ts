import type {
  LoginRequest,
  AuthTokens,
  RefreshResponse,
  UserRole,
  SessionUser,
} from "@yacco/shared";

/**
 * La sesión: access token en memoria del navegador, refresh token en una
 * cookie httpOnly que la API escribe y este código no ve (D-024). Los datos
 * autenticados se siguen pidiendo desde el cliente (D-022); el SSR sirve el
 * shell, el login y lo público.
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
    sessionMarker.clear();
    applyAccessToken(null);
    expired.value = reason === "expired";
  }

  /** Canjea la cookie del refresh por un access token nuevo. Lanza SessionExpiredError si ya no vale. */
  function refreshAccessToken(): Promise<string> {
    internals.refreshing ??= (async () => {
      // La cookie viaja sola: misma origen, por el proxy de D-021.
      const response = await sendToApi("/auth/refresh", { method: "POST" });
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
   * Al recargar, el access token en memoria se perdió: si este navegador tuvo
   * sesión, se canjea la cookie antes de decidir. Con sesión, o sin marca, no
   * hace nada; si falla, borra la marca, así que el middleware puede llamarla
   * en cada navegación sin repetir un canje perdido.
   */
  function restore(): Promise<void> {
    if (user.value !== null || !sessionMarker.present()) {
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
    // El refresh quedó en la cookie: del cuerpo solo se usa el access token.
    const tokens = response.data as AuthTokens;
    sessionMarker.set();
    applyAccessToken(tokens.accessToken);
    expired.value = false;
  }

  async function logout(): Promise<void> {
    end("manual");
    // Que la API borre la cookie: sin esto, el próximo restore volvería a
    // entrar. Si falla (sin red), la marca ya no está y no se intenta.
    await sendToApi("/auth/logout", { method: "POST" }).catch(() => undefined);
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
