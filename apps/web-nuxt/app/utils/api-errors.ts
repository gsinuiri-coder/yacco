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

export const SESSION_EXPIRED_MESSAGE = "Tu sesión venció. Vuelve a ingresar.";

/**
 * El refresh falló o no había refresh token: la sesión no se recupera y hay
 * que volver a ingresar. Se distingue de ApiError porque ninguna pantalla debe
 * mostrarla como error de su formulario: la muestra el login.
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

/** El texto que una pantalla muestra para un error de la capa de datos. */
export function describeApiFailure(error: unknown): string {
  if (error instanceof ApiError || error instanceof RequestTimeoutError) {
    return error.message;
  }
  return "No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.";
}
