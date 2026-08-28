import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server";
import { createApiClient } from "./api-client";
import type { ApiClientDeps } from "./api-client";
import { createRoute, getRoute, listRoutes } from "./routes";

const BASE_URL = "http://api.test/api/v1";
const ROUTE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DRIVER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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

const EMPTY_PAGE = { data: [], total: 0, page: 1, limit: 20, totalPages: 0 };

describe("listRoutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sin params pega a /routes pelado", async () => {
    let requestedUrl = "";
    server.use(
      http.get(`${BASE_URL}/routes`, ({ request }) => {
        requestedUrl = request.url;
        return HttpResponse.json(EMPTY_PAGE);
      }),
    );

    const client = createApiClient(buildDeps());
    await expect(listRoutes(client)).resolves.toEqual(EMPTY_PAGE);
    expect(requestedUrl).toBe(`${BASE_URL}/routes`);
  });

  it("manda los cuatro filtros y la paginación en la query", async () => {
    let requestedUrl = "";
    server.use(
      http.get(`${BASE_URL}/routes`, ({ request }) => {
        requestedUrl = request.url;
        return HttpResponse.json(EMPTY_PAGE);
      }),
    );

    const client = createApiClient(buildDeps());
    await listRoutes(client, {
      page: 2,
      limit: 20,
      date: "2026-08-28",
      driverId: DRIVER_ID,
      zoneId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      status: "PLANNED",
    });

    const params = new URL(requestedUrl).searchParams;
    expect(params.get("page")).toBe("2");
    expect(params.get("limit")).toBe("20");
    // La fecha viaja como el texto "AAAA-MM-DD" que llegó, sin pasar por Date.
    expect(params.get("date")).toBe("2026-08-28");
    expect(params.get("driverId")).toBe(DRIVER_ID);
    expect(params.get("status")).toBe("PLANNED");
  });
});

describe("getRoute", () => {
  it("pide el detalle por id", async () => {
    server.use(
      http.get(`${BASE_URL}/routes/${ROUTE_ID}`, () =>
        HttpResponse.json({ id: ROUTE_ID, stops: [] }),
      ),
    );

    const client = createApiClient(buildDeps());
    await expect(getRoute(client, ROUTE_ID)).resolves.toMatchObject({ id: ROUTE_ID });
  });
});

describe("createRoute", () => {
  it("hace POST /routes con el cuerpo tal cual", async () => {
    let body: unknown;
    server.use(
      http.post(`${BASE_URL}/routes`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: ROUTE_ID }, { status: 201 });
      }),
    );

    const client = createApiClient(buildDeps());
    await createRoute(client, { driverId: DRIVER_ID, date: "2026-08-28" });

    expect(body).toEqual({ driverId: DRIVER_ID, date: "2026-08-28" });
  });
});
