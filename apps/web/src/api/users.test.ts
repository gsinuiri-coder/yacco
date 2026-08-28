import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server";
import { createApiClient } from "./api-client";
import type { ApiClientDeps } from "./api-client";
import { listUsers } from "./users";

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

describe("listUsers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sin params pega a /users pelado", async () => {
    let requestedUrl = "";
    server.use(
      http.get(`${BASE_URL}/users`, ({ request }) => {
        requestedUrl = request.url;
        return HttpResponse.json([]);
      }),
    );

    const client = createApiClient(buildDeps());
    await expect(listUsers(client)).resolves.toEqual([]);
    expect(requestedUrl).toBe(`${BASE_URL}/users`);
  });

  it("con { role: 'DRIVER' } pega a /users?role=DRIVER", async () => {
    let requestedUrl = "";
    server.use(
      http.get(`${BASE_URL}/users`, ({ request }) => {
        requestedUrl = request.url;
        return HttpResponse.json([]);
      }),
    );

    const client = createApiClient(buildDeps());
    await expect(listUsers(client, { role: "DRIVER" })).resolves.toEqual([]);
    expect(requestedUrl).toBe(`${BASE_URL}/users?role=DRIVER`);
  });
});
