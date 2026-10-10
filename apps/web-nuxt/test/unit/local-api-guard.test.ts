import { describe, expect, it } from "vitest";
import { LOCAL_API_ORIGIN } from "../../config/api-proxy";
import {
  VERIFIED_FOR_MS,
  createLocalApiGuard,
  foreignApiMessage,
  foreignApiResponse,
  isProxiedPath,
} from "../../config/local-api-guard";

const ORIGIN = "http://localhost:3200";

/** Un /health que contesta lo que se le pida, y cuenta cuántas veces se lo llamó. */
function fakeHealth(answer: () => Promise<{ ok: boolean; json: () => Promise<unknown> }>) {
  const calls: string[] = [];
  return {
    calls,
    fetcher: (url: string) => {
      calls.push(url);
      return answer();
    },
  };
}

const yacco = () =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ status: "ok", service: "yacco-api" }),
  });

describe("guardia del proxy de desarrollo", () => {
  it("los defaults de desarrollo de Yacco no chocan con el 3100 de otros proyectos", () => {
    expect(LOCAL_API_ORIGIN).toBe("http://localhost:3200");
  });

  it("con la API de Yacco del otro lado, deja pasar", async () => {
    const health = fakeHealth(yacco);

    expect(await createLocalApiGuard(ORIGIN, health.fetcher).check()).toBeNull();
    expect(health.calls).toEqual([`${ORIGIN}/health`]);
  });

  it("otra API que también contesta /health con 200 se rechaza con el porqué", async () => {
    // Lo que contestaba el otro proyecto el 2026-10-09.
    const health = fakeHealth(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "ok", db: "ok" }) }),
    );

    expect(await createLocalApiGuard(ORIGIN, health.fetcher).check()).toBe(
      foreignApiMessage(ORIGIN),
    );
    expect(foreignApiMessage(ORIGIN)).toContain("contesta otra aplicación, no la API de Yacco");
  });

  it("un /health que no es JSON o que no da 200 tampoco es Yacco", async () => {
    const html = fakeHealth(() =>
      Promise.resolve({ ok: true, json: () => Promise.reject(new SyntaxError("no es JSON")) }),
    );
    const notFound = fakeHealth(() => Promise.resolve({ ok: false, json: () => yacco() }));

    expect(await createLocalApiGuard(ORIGIN, html.fetcher).check()).toBe(foreignApiMessage(ORIGIN));
    expect(await createLocalApiGuard(ORIGIN, notFound.fetcher).check()).toBe(
      foreignApiMessage(ORIGIN),
    );
  });

  it("si no contesta nadie, deja que el proxy falle solo", async () => {
    const health = fakeHealth(() => Promise.reject(new TypeError("fetch failed")));

    expect(await createLocalApiGuard(ORIGIN, health.fetcher).check()).toBeNull();
  });

  it("una verificación buena se recuerda un rato; una mala se repite en cada pedido", async () => {
    let clock = 0;
    let answer = yacco;
    const health = fakeHealth(() => answer());
    const guard = createLocalApiGuard(ORIGIN, health.fetcher, () => clock);

    await guard.check();
    clock = VERIFIED_FOR_MS - 1;
    await guard.check();
    expect(health.calls).toHaveLength(1);

    clock = VERIFIED_FOR_MS;
    answer = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    expect(await guard.check()).not.toBeNull();
    expect(await guard.check()).not.toBeNull();
    expect(health.calls).toHaveLength(3);
  });

  it("solo mira lo que el proxy reenvía a la API", () => {
    expect(isProxiedPath("/api/v1/auth/login")).toBe(true);
    expect(isProxiedPath("/health")).toBe(true);
    expect(isProxiedPath("/health?x=1")).toBe(true);
    expect(isProxiedPath("/login")).toBe(false);
    expect(isProxiedPath("/_nuxt/app.js")).toBe(false);
    expect(isProxiedPath("/healthy")).toBe(false);
  });

  it("el servidor de desarrollo contesta 502 con el porqué, y solo en lo que va a la API", async () => {
    const foreign = { check: () => Promise.resolve("otra API") };
    const fine = { check: () => Promise.resolve(null) };

    expect(await foreignApiResponse("/api/v1/auth/login", foreign)).toEqual({
      statusCode: 502,
      message: "otra API",
    });
    expect(await foreignApiResponse("/login", foreign)).toBeNull();
    expect(await foreignApiResponse("/api/v1/auth/login", fine)).toBeNull();
  });
});
