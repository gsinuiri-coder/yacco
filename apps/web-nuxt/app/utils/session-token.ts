import type { SessionUser } from "@yacco/shared";

export const REFRESH_TOKEN_KEY = "yacco.refreshToken";

/**
 * Lee el payload de un JWT SIN verificar la firma. Verificar es trabajo de la
 * API, que valida firma y vencimiento en cada petición: un token alterado en
 * el navegador sólo consigue un 401. Acá sólo sirve para pintar quién está
 * conectado, porque la API no expone `/auth/me`.
 */
export function readSessionUser(token: string): SessionUser | null {
  const segments = token.split(".");
  if (segments.length !== 3 || !segments[1]) return null;

  let payload: Record<string, unknown>;
  try {
    const base64 = segments[1].replaceAll("-", "+").replaceAll("_", "/");
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    // TextDecoder y no atob a secas: atob devuelve latin-1 y un usuario con
    // tildes llegaría corrupto.
    payload = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  } catch {
    return null;
  }

  const { sub, username, roles } = payload;
  if (typeof sub !== "string" || typeof username !== "string" || !Array.isArray(roles)) {
    return null;
  }
  return { id: sub, username, roles: roles as SessionUser["roles"] };
}

/**
 * El refresh token ya NO está acá: la API lo deja en una cookie httpOnly que
 * este código no puede leer (D-024). Lo único que el navegador guarda es una
 * marca sin secreto —«en este navegador hubo una sesión»—, que sirve para dos
 * cosas: no pedir un refresh cuando nadie ingresó nunca, y saber si un refresh
 * que falla es una sesión que VENCIÓ (se avisa) o que nunca existió (no).
 *
 * `LEGACY_REFRESH_TOKEN_KEY` es donde el web guardaba el token antes del
 * cambio: se borra al pasar por acá, para que no quede un token renovable en
 * disco. Safari en modo privado lanza al tocar localStorage; se degrada sin
 * romper la app.
 */
export const SESSION_MARKER_KEY = "yacco.session";
export const LEGACY_REFRESH_TOKEN_KEY = "yacco.refreshToken";

function safely(action: () => void): void {
  try {
    action();
  } catch {
    // Sin almacenamiento, la marca no persiste: la sesión dura lo que la pestaña.
  }
}

export const sessionMarker = {
  present(): boolean {
    try {
      return localStorage.getItem(SESSION_MARKER_KEY) === "1";
    } catch {
      return false;
    }
  },
  set(): void {
    safely(() => {
      localStorage.setItem(SESSION_MARKER_KEY, "1");
      localStorage.removeItem(LEGACY_REFRESH_TOKEN_KEY);
    });
  },
  clear(): void {
    safely(() => {
      localStorage.removeItem(SESSION_MARKER_KEY);
      localStorage.removeItem(LEGACY_REFRESH_TOKEN_KEY);
    });
  },
};

/**
 * A dónde volver después del login. Sólo una ruta interna: `//otro.sitio` o
 * `/\otro.sitio` los navegadores los leen como otro origen, y copiar a ciegas
 * lo que trae la URL es un open redirect.
 */
export function safeReturnPath(from: unknown): string {
  if (typeof from !== "string" || !from.startsWith("/")) return "/";
  if (from.startsWith("//") || from.startsWith("/\\")) return "/";
  return from;
}
