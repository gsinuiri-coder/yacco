const REFRESH_TOKEN_KEY = "yacco.refreshToken";

/**
 * TODO(seguridad, antes del piloto de campo): mover el refresh token a una
 * cookie httpOnly + SameSite emitida por la API. En localStorage queda
 * expuesto a cualquier XSS que logre ejecutar script en el origen.
 * Ver docs/backlog-tecnico.md → "Refresh token en localStorage".
 *
 * El access token NO se persiste: vive solo en memoria (estado de React),
 * así que un XSS tampoco lo encuentra en disco y se pierde al recargar,
 * momento en que se recupera con el refresh.
 */
export function readRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  } catch {
    // Safari en modo privado lanza al tocar localStorage.
    return null;
  }
}

export function writeRefreshToken(token: string): void {
  try {
    localStorage.setItem(REFRESH_TOKEN_KEY, token);
  } catch {
    // Sin persistencia la sesión dura lo que dure la pestaña; no es fatal.
  }
}

export function clearRefreshToken(): void {
  try {
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  } catch {
    // Idem: nada que limpiar si el almacenamiento no está disponible.
  }
}
