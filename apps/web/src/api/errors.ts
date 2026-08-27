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

/**
 * Compartido con login-page.tsx, que lo muestra cuando ProtectedRoute
 * redirige ahí por una sesión vencida (no por un logout manual) — así el
 * texto no queda duplicado como string suelto en dos archivos.
 */
export const SESSION_EXPIRED_MESSAGE = "La sesión expiró. Inicia sesión nuevamente.";

/**
 * El refresh falló o no había refresh token: la sesión no es recuperable y
 * hay que volver a /login. Se distingue de ApiError porque el llamador no
 * debe mostrarla como un error del formulario.
 */
export class SessionExpiredError extends Error {
  constructor() {
    super(SESSION_EXPIRED_MESSAGE);
    this.name = "SessionExpiredError";
  }
}

/** La petición superó REQUEST_TIMEOUT_MS. */
export class RequestTimeoutError extends Error {
  constructor() {
    super("El servidor no respondió a tiempo. Inténtalo de nuevo.");
    this.name = "RequestTimeoutError";
  }
}
