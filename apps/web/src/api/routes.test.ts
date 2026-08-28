import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server";
import { createApiClient } from "./api-client";
import type { ApiClientDeps } from "./api-client";
import {
  addRouteStop,
  createRoute,
  finishRoute,
  getRoute,
  listRoutes,
  removeRouteStop,
  reorderRouteStops,
  startRoute,
} from "./routes";

const BASE_URL = "http://api.test/api/v1";
const ROUTE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DRIVER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const STOP_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ORDER_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

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

describe("estructura de la ruta", () => {
  it("addRouteStop manda origin y el id que corresponde a ese origen", async () => {
    let body: unknown;
    server.use(
      http.post(`${BASE_URL}/routes/${ROUTE_ID}/stops`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: STOP_ID }, { status: 201 });
      }),
    );

    const client = createApiClient(buildDeps());
    await addRouteStop(client, ROUTE_ID, { origin: "ORDER", orderId: ORDER_ID });

    expect(body).toEqual({ origin: "ORDER", orderId: ORDER_ID });
  });

  // 204 sin cuerpo: `response.json()` sobre un cuerpo vacío reventaría.
  it("removeRouteStop resuelve con un 204 sin cuerpo", async () => {
    server.use(
      http.delete(
        `${BASE_URL}/routes/${ROUTE_ID}/stops/${STOP_ID}`,
        () => new HttpResponse(null, { status: 204 }),
      ),
    );

    const client = createApiClient(buildDeps());
    await expect(removeRouteStop(client, ROUTE_ID, STOP_ID)).resolves.toBeUndefined();
  });

  it("reorderRouteStops manda la lista completa bajo stopIds", async () => {
    let body: unknown;
    server.use(
      http.patch(`${BASE_URL}/routes/${ROUTE_ID}/stops/reorder`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: ROUTE_ID, stops: [] });
      }),
    );

    const client = createApiClient(buildDeps());
    await reorderRouteStops(client, ROUTE_ID, [STOP_ID, ORDER_ID]);

    expect(body).toEqual({ stopIds: [STOP_ID, ORDER_ID] });
  });

  it("startRoute y finishRoute son PATCH sin cuerpo", async () => {
    const methods: string[] = [];
    const bodies: string[] = [];
    for (const action of ["start", "finish"]) {
      server.use(
        http.patch(`${BASE_URL}/routes/${ROUTE_ID}/${action}`, async ({ request }) => {
          methods.push(request.method);
          bodies.push(await request.text());
          return HttpResponse.json({ id: ROUTE_ID, stops: [] });
        }),
      );
    }

    const client = createApiClient(buildDeps());
    await startRoute(client, ROUTE_ID);
    await finishRoute(client, ROUTE_ID);

    expect(methods).toEqual(["PATCH", "PATCH"]);
    expect(bodies).toEqual(["", ""]);
  });
});
