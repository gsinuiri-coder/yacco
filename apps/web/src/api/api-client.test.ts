import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server";
import { buildToken } from "../test/tokens";
import { createApiClient } from "./api-client";
import type { ApiClientDeps } from "./api-client";
import { ApiError, RequestTimeoutError, SessionExpiredError } from "./errors";
import { REQUEST_TIMEOUT_MS } from "./timing";

const BASE_URL = "http://api.test/api/v1";

function buildDeps(overrides: Partial<ApiClientDeps> = {}) {
  return {
    baseUrl: BASE_URL,
    getAccessToken: vi.fn(() => "access-viejo"),
    getRefreshToken: vi.fn<() => string | null>(() => "refresh-valido"),
    onAccessTokenRefreshed: vi.fn(),
    onSessionExpired: vi.fn(),
    ...overrides,
  } satisfies ApiClientDeps;
}

describe("apiClient", () => {
  let deps: ReturnType<typeof buildDeps>;

  beforeEach(() => {
    deps = buildDeps();
  });

  it("adjunta el access token en el header Authorization", async () => {
    const authorizationHeaders: (string | null)[] = [];
    server.use(
      http.get(`${BASE_URL}/customers`, ({ request }) => {
        authorizationHeaders.push(request.headers.get("Authorization"));
        return HttpResponse.json([{ id: "c1" }]);
      }),
    );

    const client = createApiClient(deps);
    await expect(client.request("/customers")).resolves.toEqual([{ id: "c1" }]);
    expect(authorizationHeaders).toEqual(["Bearer access-viejo"]);
  });

  it("no adjunta el access token cuando la petición es skipAuth", async () => {
    const accessToken = buildToken();
    server.use(
      http.post(`${BASE_URL}/auth/login`, ({ request }) => {
        expect(request.headers.get("Authorization")).toBeNull();
        return HttpResponse.json({ accessToken, refreshToken: "refresh-nuevo" });
      }),
    );

    const client = createApiClient(deps);
    await expect(client.login({ username: "admin", password: "admin123" })).resolves.toEqual({
      accessToken,
      refreshToken: "refresh-nuevo",
    });
  });

  it("ante un 401 refresca una vez y reintenta la petición original", async () => {
    const authorizationHeaders: (string | null)[] = [];
    let refreshCalls = 0;

    server.use(
      http.get(`${BASE_URL}/customers`, ({ request }) => {
        const authorization = request.headers.get("Authorization");
        authorizationHeaders.push(authorization);
        if (authorization === "Bearer access-viejo") {
          return new HttpResponse(null, { status: 401 });
        }
        return HttpResponse.json([{ id: "c1" }]);
      }),
      http.post(`${BASE_URL}/auth/refresh`, ({ request }) => {
        refreshCalls += 1;
        // El refresh token viaja como bearer, no en el cuerpo.
        expect(request.headers.get("Authorization")).toBe("Bearer refresh-valido");
        return HttpResponse.json({ accessToken: "access-nuevo" });
      }),
    );

    const client = createApiClient(deps);
    await expect(client.request("/customers")).resolves.toEqual([{ id: "c1" }]);

    expect(refreshCalls).toBe(1);
    expect(authorizationHeaders).toEqual(["Bearer access-viejo", "Bearer access-nuevo"]);
    expect(deps.onAccessTokenRefreshed).toHaveBeenCalledWith("access-nuevo");
    expect(deps.onSessionExpired).not.toHaveBeenCalled();
  });

  it("cierra la sesión si el refresh falla", async () => {
    server.use(
      http.get(`${BASE_URL}/customers`, () => new HttpResponse(null, { status: 401 })),
      http.post(`${BASE_URL}/auth/refresh`, () => new HttpResponse(null, { status: 401 })),
    );

    const client = createApiClient(deps);
    await expect(client.request("/customers")).rejects.toBeInstanceOf(SessionExpiredError);
    expect(deps.onSessionExpired).toHaveBeenCalledTimes(1);
    expect(deps.onAccessTokenRefreshed).not.toHaveBeenCalled();
  });

  it("cierra la sesión sin llamar al refresh si no hay refresh token", async () => {
    let refreshCalls = 0;
    deps = buildDeps({ getRefreshToken: vi.fn<() => string | null>(() => null) });

    server.use(
      http.get(`${BASE_URL}/customers`, () => new HttpResponse(null, { status: 401 })),
      http.post(`${BASE_URL}/auth/refresh`, () => {
        refreshCalls += 1;
        return HttpResponse.json({ accessToken: "no-deberia-pedirse" });
      }),
    );

    const client = createApiClient(deps);
    await expect(client.request("/customers")).rejects.toBeInstanceOf(SessionExpiredError);
    expect(refreshCalls).toBe(0);
    expect(deps.onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it("no reintenta más de una vez: un segundo 401 cierra la sesión", async () => {
    let refreshCalls = 0;
    server.use(
      http.get(`${BASE_URL}/customers`, () => new HttpResponse(null, { status: 401 })),
      http.post(`${BASE_URL}/auth/refresh`, () => {
        refreshCalls += 1;
        return HttpResponse.json({ accessToken: "access-nuevo" });
      }),
    );

    const client = createApiClient(deps);
    await expect(client.request("/customers")).rejects.toBeInstanceOf(SessionExpiredError);
    expect(refreshCalls).toBe(1);
    expect(deps.onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it("no intenta refrescar cuando el 401 viene del propio login", async () => {
    let refreshCalls = 0;
    server.use(
      http.post(`${BASE_URL}/auth/login`, () =>
        HttpResponse.json({ message: "Invalid credentials" }, { status: 401 }),
      ),
      http.post(`${BASE_URL}/auth/refresh`, () => {
        refreshCalls += 1;
        return HttpResponse.json({ accessToken: "no-deberia-pedirse" });
      }),
    );

    const client = createApiClient(deps);
    await expect(client.login({ username: "admin", password: "mala" })).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(refreshCalls).toBe(0);
    expect(deps.onSessionExpired).not.toHaveBeenCalled();
  });

  it("expone el mensaje de error de la API", async () => {
    server.use(
      http.get(`${BASE_URL}/customers`, () =>
        HttpResponse.json({ message: ["name no puede estar vacío"] }, { status: 400 }),
      ),
    );

    const client = createApiClient(deps);
    await expect(client.request("/customers")).rejects.toThrow("name no puede estar vacío");
  });

  it("resuelve sin intentar parsear un 204 sin cuerpo", async () => {
    server.use(
      http.delete(`${BASE_URL}/customers/c1`, () => new HttpResponse(null, { status: 204 })),
    );

    const client = createApiClient(deps);
    await expect(client.request("/customers/c1", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("usa el statusText cuando el cuerpo del error no es JSON", async () => {
    server.use(
      http.get(
        `${BASE_URL}/customers`,
        () => new HttpResponse("gateway caído", { status: 502, statusText: "Bad Gateway" }),
      ),
    );

    const client = createApiClient(deps);
    await expect(client.request("/customers")).rejects.toThrow("Bad Gateway");
  });
});

describe("timeout de arranque en frío", () => {
  it("aborta la petición al superar REQUEST_TIMEOUT_MS", async () => {
    vi.useFakeTimers();
    server.use(
      http.get(`${BASE_URL}/customers`, async () => {
        // Nunca responde: solo el AbortController debe cortar la espera.
        await new Promise(() => {});
        return HttpResponse.json({});
      }),
    );

    const client = createApiClient(buildDeps());
    const pending = client.request("/customers");
    const assertion = expect(pending).rejects.toBeInstanceOf(RequestTimeoutError);

    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await assertion;

    vi.useRealTimers();
  });

  it("no dispara el timeout si la respuesta llega antes", async () => {
    server.use(http.get(`${BASE_URL}/customers`, () => HttpResponse.json([])));

    const client = createApiClient(buildDeps());
    await expect(client.request("/customers")).resolves.toEqual([]);
    expect(REQUEST_TIMEOUT_MS).toBe(75_000);
  });
});
