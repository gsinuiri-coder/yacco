import { afterEach, describe, expect, it, vi } from "vitest";
import { buildToken } from "../support/session";

describe("readSessionUser", () => {
  it("lee usuario y roles del payload, con tildes intactas", () => {
    const token = buildToken({ sub: "u-1", username: "Begoña", roles: ["SELLER", "DRIVER"] });

    expect(readSessionUser(token)).toEqual({
      id: "u-1",
      username: "Begoña",
      roles: ["SELLER", "DRIVER"],
    });
  });

  it("devuelve null para lo que no es un JWT legible", () => {
    expect(readSessionUser("no-es-jwt")).toBeNull();
    expect(readSessionUser("a..c")).toBeNull();
    expect(readSessionUser("a.%%%.c")).toBeNull();
    expect(readSessionUser(`a.${btoa('{"sub":1}')}.c`)).toBeNull();
  });
});

describe("safeReturnPath", () => {
  it("sólo acepta una ruta interna", () => {
    expect(safeReturnPath("/customers?page=2")).toBe("/customers?page=2");
    expect(safeReturnPath("//evil.example")).toBe("/");
    expect(safeReturnPath("/\\evil.example")).toBe("/");
    expect(safeReturnPath("https://evil.example")).toBe("/");
    expect(safeReturnPath(["/a"])).toBe("/");
    expect(safeReturnPath(undefined)).toBe("/");
  });
});

describe("sessionMarker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("marca, lee y borra, sin guardar ningún token", () => {
    sessionMarker.set();
    expect(sessionMarker.present()).toBe(true);
    sessionMarker.clear();
    expect(sessionMarker.present()).toBe(false);
  });

  // Antes del cambio el web guardaba el refresh token en disco: pasar por la
  // marca lo borra, para que no quede un token renovable al alcance de un XSS.
  it("borra el refresh token que haya dejado la versión anterior", () => {
    localStorage.setItem("yacco.refreshToken", "token-viejo");
    sessionMarker.set();
    expect(localStorage.getItem("yacco.refreshToken")).toBeNull();
  });

  // Safari en modo privado lanza al tocar localStorage.
  it("no rompe la app si el almacenamiento no está disponible", () => {
    const blocked = () => {
      throw new Error("almacenamiento bloqueado");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(blocked);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(blocked);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(blocked);

    expect(sessionMarker.present()).toBe(false);
    expect(() => sessionMarker.set()).not.toThrow();
    expect(() => sessionMarker.clear()).not.toThrow();
  });
});

describe("visibleNavigation", () => {
  it("esconde una sección entera si ninguno de sus enlaces es para ese rol", () => {
    NAVIGATION.push({
      label: "Sólo admin",
      links: [{ label: "Cuadre", icon: "i-lucide-scale", to: "/x", onlyFor: "ADMIN" }],
    });
    try {
      expect(visibleNavigation(["SELLER"]).map((section) => section.label)).not.toContain(
        "Sólo admin",
      );
      expect(visibleNavigation(["ADMIN"]).map((section) => section.label)).toContain("Sólo admin");
    } finally {
      NAVIGATION.pop();
    }
  });
});

describe("el menú del chofer", () => {
  const links = (roles: Parameters<typeof visibleNavigation>[0]) =>
    visibleNavigation(roles).flatMap((section) => section.links.map((link) => link.label));

  it("quien solo es chofer ve «Mi ruta» y nada más", () => {
    expect(links(["DRIVER"])).toEqual(["Mi ruta"]);
  });

  it("la oficina ve su menú; si además reparte, también «Mi ruta»", () => {
    expect(links(["SELLER"])).toContain("Clientes");
    expect(links(["SELLER"])).not.toContain("Mi ruta");
    expect(links(["SELLER", "DRIVER"])).toEqual(expect.arrayContaining(["Clientes", "Mi ruta"]));
  });
});
