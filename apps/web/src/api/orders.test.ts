import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server";
import { createApiClient } from "./api-client";
import type { ApiClientDeps } from "./api-client";
import { listOrders } from "./orders";

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

const EMPTY_PAGE = { data: [], total: 0, page: 1, limit: 20, totalPages: 0 };

function stubList(): { url: string } {
  const captured = { url: "" };
  server.use(
    http.get(`${BASE_URL}/orders`, ({ request }) => {
      captured.url = request.url;
      return HttpResponse.json(EMPTY_PAGE);
    }),
  );
  return captured;
}

describe("listOrders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sin params pega a /orders pelado", async () => {
    const captured = stubList();

    const client = createApiClient(buildDeps());
    await expect(listOrders(client)).resolves.toEqual(EMPTY_PAGE);
    expect(captured.url).toBe(`${BASE_URL}/orders`);
  });

  // `false` es el valor que el selector de paradas necesita mandar: con
  // truthiness se perdería y la lista volvería a ofrecer pedidos ya asignados.
  it("hasRouteStop:false viaja como hasRouteStop=false, no se pierde", async () => {
    const captured = stubList();

    const client = createApiClient(buildDeps());
    await listOrders(client, { status: "PENDING", hasRouteStop: false });

    const params = new URL(captured.url).searchParams;
    expect(params.get("status")).toBe("PENDING");
    expect(params.get("hasRouteStop")).toBe("false");
  });

  it("hasRouteStop:true viaja como hasRouteStop=true", async () => {
    const captured = stubList();

    const client = createApiClient(buildDeps());
    await listOrders(client, { hasRouteStop: true });

    expect(new URL(captured.url).searchParams.get("hasRouteStop")).toBe("true");
  });

  it("omitido, la query no lleva hasRouteStop", async () => {
    const captured = stubList();

    const client = createApiClient(buildDeps());
    await listOrders(client, { page: 2 });

    expect(new URL(captured.url).searchParams.has("hasRouteStop")).toBe(false);
  });
});
