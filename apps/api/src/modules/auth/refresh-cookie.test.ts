import { describe, expect, it } from "@jest/globals";
import type { Request } from "express";
import {
  clearRefreshCookieOptions,
  readRefreshCookie,
  refreshCookieOptions,
} from "./refresh-cookie.js";

function withCookie(cookie?: string): Request {
  return { headers: cookie === undefined ? {} : { cookie } } as Request;
}

describe("readRefreshCookie", () => {
  it("encuentra la cookie del refresh entre otras", () => {
    expect(readRefreshCookie(withCookie("tema=claro; yacco_refresh=a.b.c; otra=1"))).toBe("a.b.c");
  });

  it("sin header, o sin esa cookie, o vacía, no hay token", () => {
    expect(readRefreshCookie(withCookie())).toBeNull();
    expect(readRefreshCookie(withCookie("tema=claro"))).toBeNull();
    expect(readRefreshCookie(withCookie("yacco_refresh="))).toBeNull();
  });
});

describe("opciones de la cookie", () => {
  it("borrarla usa los mismos atributos que escribirla, sin vencimiento propio", () => {
    const expires = new Date("2026-10-24T00:00:00Z");
    const { expires: written, ...rest } = refreshCookieOptions(expires);
    expect(written).toBe(expires);
    expect(clearRefreshCookieOptions()).toEqual(rest);
  });
});
