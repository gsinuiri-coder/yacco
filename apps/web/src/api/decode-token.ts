import type { AccessTokenPayload, AuthenticatedUser } from "./types";

/**
 * Lee el payload de un JWT sin verificar la firma.
 *
 * La verificación es del servidor: valida firma y expiración en cada
 * petición con JwtAccessGuard, y un token manipulado en el navegador solo
 * consigue que la API devuelva 401. Aquí el payload sirve únicamente para
 * pintar la UI, porque la API no expone ningún endpoint de usuario actual
 * (`GET /users` es solo ADMIN y no existe `/auth/me`).
 */
export function decodeAccessToken(token: string): AuthenticatedUser | null {
  const payload = parsePayload(token);
  if (!payload) {
    return null;
  }

  const { sub, username, roles } = payload;
  if (typeof sub !== "string" || typeof username !== "string" || !Array.isArray(roles)) {
    return null;
  }

  return { id: sub, username, roles };
}

function parsePayload(token: string): Partial<AccessTokenPayload> | null {
  const segments = token.split(".");
  const payloadSegment = segments[1];
  if (segments.length !== 3 || !payloadSegment) {
    return null;
  }

  try {
    return JSON.parse(decodeBase64Url(payloadSegment)) as Partial<AccessTokenPayload>;
  } catch {
    return null;
  }
}

function decodeBase64Url(segment: string): string {
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  // atob devuelve bytes latin-1; el rodeo por percent-encoding recupera el
  // UTF-8 original (un username con tildes se corrompería sin esto).
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  const percentEncoded = Array.from(binary, (character) => {
    const code = character.charCodeAt(0).toString(16).padStart(2, "0");
    return `%${code}`;
  }).join("");

  return decodeURIComponent(percentEncoded);
}
