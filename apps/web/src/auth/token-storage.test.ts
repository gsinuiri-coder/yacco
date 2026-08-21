import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRefreshToken, readRefreshToken, writeRefreshToken } from "./token-storage";

describe("token-storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("guarda, lee y borra el refresh token", () => {
    expect(readRefreshToken()).toBeNull();

    writeRefreshToken("refresh-1");
    expect(readRefreshToken()).toBe("refresh-1");

    clearRefreshToken();
    expect(readRefreshToken()).toBeNull();
  });

  // Safari en modo privado lanza al tocar localStorage: la sesión debe
  // degradarse a "solo en memoria", nunca romper la aplicación.
  it("no propaga el error si el almacenamiento no está disponible", () => {
    const unavailable = () => {
      throw new Error("almacenamiento bloqueado");
    };
    vi.spyOn(globalThis.localStorage, "getItem").mockImplementation(unavailable);
    vi.spyOn(globalThis.localStorage, "setItem").mockImplementation(unavailable);
    vi.spyOn(globalThis.localStorage, "removeItem").mockImplementation(unavailable);

    expect(readRefreshToken()).toBeNull();
    expect(() => writeRefreshToken("refresh-1")).not.toThrow();
    expect(() => clearRefreshToken()).not.toThrow();
  });
});
