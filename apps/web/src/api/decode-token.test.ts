import { describe, expect, it } from "vitest";
import { buildToken } from "../test/tokens";
import { decodeAccessToken } from "./decode-token";

describe("decodeAccessToken", () => {
  it("extrae id, usuario y roles del payload", () => {
    const token = buildToken({ username: "vendedor1", roles: ["SELLER", "DRIVER"] });

    expect(decodeAccessToken(token)).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      username: "vendedor1",
      roles: ["SELLER", "DRIVER"],
    });
  });

  it("conserva los acentos del username", () => {
    const token = buildToken({ username: "josé.muñoz" });

    expect(decodeAccessToken(token)?.username).toBe("josé.muñoz");
  });

  it("devuelve null si el token no tiene tres segmentos", () => {
    expect(decodeAccessToken("no-es-un-jwt")).toBeNull();
  });

  it("devuelve null si el payload no es JSON válido", () => {
    expect(decodeAccessToken("encabezado.@@@.firma")).toBeNull();
  });

  it("devuelve null si faltan campos obligatorios del payload", () => {
    const token = buildToken();
    const [header, , signature] = token.split(".");
    const payloadSinRoles = btoa(JSON.stringify({ sub: "abc", username: "admin" }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    expect(decodeAccessToken(`${header}.${payloadSinRoles}.${signature}`)).toBeNull();
  });
});
