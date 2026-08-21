import type { AccessTokenPayload } from "../api/types";

function base64UrlEncode(value: string): string {
  const latin1 = encodeURIComponent(value).replace(/%([0-9A-F]{2})/g, (_match, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
  return btoa(latin1).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** JWT con firma de mentira: el cliente solo lee el payload, nunca la verifica. */
export function buildToken(overrides: Partial<AccessTokenPayload> = {}): string {
  const payload: AccessTokenPayload = {
    sub: "11111111-1111-4111-8111-111111111111",
    username: "admin",
    roles: ["ADMIN"],
    type: "access",
    ...overrides,
  };

  return [
    base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" })),
    base64UrlEncode(JSON.stringify(payload)),
    "firma-de-prueba",
  ].join(".");
}
