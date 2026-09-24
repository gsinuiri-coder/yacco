import type { CookieOptions, Request } from "express";

/**
 * El refresh token en una cookie que el JavaScript de la página no puede leer
 * (D-024). El web llega a la API por su propio origen —el proxy de D-021—, así
 * que la cookie es de primera parte y no hace falta CORS con credenciales.
 *
 * - `HttpOnly`: un XSS no la encuentra.
 * - `Secure`: solo por HTTPS; los navegadores aceptan `localhost` como seguro,
 *   así que vale también en desarrollo.
 * - `SameSite=Lax`: no viaja en un POST que otro sitio dispare, que es lo único
 *   que podría usarla (refresh y logout son POST).
 * - `Path=/api/v1/auth`: no acompaña a ninguna otra petición.
 */
export const REFRESH_COOKIE = "yacco_refresh";
const REFRESH_COOKIE_PATH = "/api/v1/auth";

export function refreshCookieOptions(expires: Date): CookieOptions {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: REFRESH_COOKIE_PATH,
    expires,
  };
}

/** Para borrarla, los mismos atributos que al escribirla, sin vencimiento. */
export function clearRefreshCookieOptions(): CookieOptions {
  const options = refreshCookieOptions(new Date(0));
  delete options.expires;
  return options;
}

/**
 * El valor de la cookie, leído a mano del header: una sola cookie y un formato
 * fijo no justifican sumar `cookie-parser`.
 */
export function readRefreshCookie(request: Request): string | null {
  const header = request.headers.cookie;
  if (header === undefined) return null;
  for (const part of header.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === REFRESH_COOKIE) {
      const token = decodeURIComponent(value.join("="));
      return token === "" ? null : token;
    }
  }
  return null;
}
