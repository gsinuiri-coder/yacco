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
 * El refresh token en localStorage, igual que el web React (D-022). Mover la
 * sesión a una cookie httpOnly es una fase propia: toca auth de producción.
 * Safari en modo privado lanza al tocar localStorage; la sesión se degrada a
 * "sólo mientras dure la pestaña", nunca rompe la app.
 */
export const refreshTokenStore = {
  read(): string | null {
    try {
      return localStorage.getItem(REFRESH_TOKEN_KEY);
    } catch {
      return null;
    }
  },
  write(token: string): void {
    try {
      localStorage.setItem(REFRESH_TOKEN_KEY, token);
    } catch {
      // Sin persistencia la sesión dura lo que la pestaña.
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(REFRESH_TOKEN_KEY);
    } catch {
      // Nada que limpiar si el almacenamiento no está disponible.
    }
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
