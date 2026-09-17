import type { AccessTokenPayload, UserRole } from "@yacco/shared";
import { registerEndpoint } from "@nuxt/test-utils/runtime";
import { vi } from "vitest";
import { clearNuxtState } from "#app";

function base64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** JWT con firma de mentira: el cliente sólo lee el payload, nunca lo verifica. */
export function buildToken(overrides: Partial<AccessTokenPayload> = {}): string {
  const payload: AccessTokenPayload = {
    sub: "11111111-1111-4111-8111-111111111111",
    username: "admin",
    roles: ["ADMIN"],
    type: "access",
    ...overrides,
  };
  return [
    base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" })),
    base64Url(JSON.stringify(payload)),
    "firma-de-prueba",
  ].join(".");
}

/** Cada test arranca como una carga de página nueva: sin sesión en memoria ni en disco. */
export function resetSession(): void {
  localStorage.clear();
  clearNuxtState(["session:user", "session:expired"]);
}

/**
 * Deja una sesión para restaurar como la encuentra el middleware al recargar:
 * un refresh token en disco y un /auth/refresh que devuelve un access token.
 * Devuelve la función que quita el endpoint.
 */
export function signIn(roles: UserRole[] = ["ADMIN"], username = "admin"): () => void {
  localStorage.setItem("yacco.refreshToken", "refresh-valido");
  return registerEndpoint("/api/v1/auth/refresh", {
    method: "POST",
    handler: () => ({ accessToken: buildToken({ roles, username }) }),
  });
}

/**
 * El adaptador h3 de @nuxt/test-utils no le pasa al handler los headers que
 * arma ofetch, así que el Authorization se lee donde sale: en la llamada a
 * `$fetch.raw`. Devuelve, por cada petición a `path`, el header enviado.
 */
export function recordBearers(path: string): () => Array<string | undefined> {
  const raw = vi.spyOn(globalThis.$fetch, "raw");
  return () =>
    raw.mock.calls
      .filter(([url]) => url === `/api/v1${path}`)
      .map(([, options]) => (options?.headers as Record<string, string>)?.Authorization);
}
