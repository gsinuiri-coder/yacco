import { registerEndpoint } from "@nuxt/test-utils/runtime";
import { readBody, setResponseStatus } from "h3";
import type { H3Event } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildToken, recordBearers, resetSession } from "../support/session";

const cleanups: Array<() => void> = [];

function endpoint(...args: Parameters<typeof registerEndpoint>) {
  cleanups.push(registerEndpoint(...args));
}

async function signInWithLogin(accessToken = buildToken()) {
  endpoint("/api/v1/auth/login", {
    method: "POST",
    handler: () => ({ accessToken, refreshToken: "refresh-1" }),
    once: true,
  });
  await useSession().login({ username: "admin", password: "x" });
}

/** Contesta 401 las primeras `times` veces y después `body`. */
function unauthorizedThen(times: number, body: unknown) {
  let calls = 0;
  const handler = (event: H3Event) => {
    calls++;
    if (calls <= times) {
      setResponseStatus(event, 401);
      return { message: "Unauthorized" };
    }
    return body;
  };
  return { handler, calls: () => calls };
}

describe("useApi — la única puerta a la API", () => {
  beforeEach(async () => {
    resetSession();
    await navigateTo("/login");
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    vi.restoreAllMocks();
  });

  it("pone el access token vigente y manda query y cuerpo", async () => {
    const token = buildToken();
    await signInWithLogin(token);
    const bearers = recordBearers("/customers");
    const seen: unknown[] = [];
    endpoint("/api/v1/customers", {
      method: "POST",
      handler: async (event) => {
        seen.push(await readBody(event), event.path);
        return { id: "c-1" };
      },
    });

    const created = await useApi().request<{ id: string }>("/customers", {
      method: "POST",
      body: { name: "Bodega Rosa" },
      query: { page: 2 },
    });

    expect(created).toEqual({ id: "c-1" });
    expect(seen).toEqual([{ name: "Bodega Rosa" }, "/_/api/v1/customers?page=2"]);
    expect(bearers()).toEqual([`Bearer ${token}`]);
  });

  it("ante un 401 renueva el token UNA vez y reintenta con el nuevo", async () => {
    await signInWithLogin(buildToken({ username: "vencido" }));
    const renewed = buildToken({ username: "renovado" });
    const refreshBearers = recordBearers("/auth/refresh");
    const zoneBearers = recordBearers("/zones");
    endpoint("/api/v1/auth/refresh", { method: "POST", handler: () => ({ accessToken: renewed }) });
    endpoint("/api/v1/zones", unauthorizedThen(1, [{ id: "z-1" }]).handler);

    const zones = await useApi().request("/zones");

    expect(zones).toEqual([{ id: "z-1" }]);
    expect(zoneBearers()).toEqual([
      `Bearer ${buildToken({ username: "vencido" })}`,
      `Bearer ${renewed}`,
    ]);
    // El refresh token viaja en Authorization: JwtRefreshStrategy lo lee de ahí.
    expect(refreshBearers()).toEqual(["Bearer refresh-1"]);
    expect(useSession().user.value?.username).toBe("renovado");
  });

  it("dos 401 simultáneos comparten un solo refresh", async () => {
    await signInWithLogin();
    let refreshes = 0;
    endpoint("/api/v1/auth/refresh", {
      method: "POST",
      handler: async () => {
        refreshes++;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { accessToken: buildToken() };
      },
    });
    endpoint("/api/v1/zones", unauthorizedThen(2, []).handler);

    await Promise.all([useApi().request("/zones"), useApi().request("/zones")]);

    expect(refreshes).toBe(1);
  });

  it("si el refresh no vale, cierra la sesión como vencida y lleva al login con la ruta actual", async () => {
    await signInWithLogin();
    await navigateTo("/?pagina=2");
    endpoint("/api/v1/auth/refresh", {
      method: "POST",
      handler: (event) => {
        setResponseStatus(event, 401);
        return {};
      },
    });
    endpoint("/api/v1/zones", unauthorizedThen(1, []).handler);

    await expect(useApi().request("/zones")).rejects.toBeInstanceOf(SessionExpiredError);

    expect(useSession().user.value).toBeNull();
    expect(useSession().expired.value).toBe(true);
    expect(localStorage.getItem("yacco.refreshToken")).toBeNull();
    expect(useRouter().currentRoute.value.path).toBe("/login");
    expect(useRouter().currentRoute.value.query.from).toBe("/?pagina=2");
  });

  it("perder la sesión estando en el login no anida ?from=/login", async () => {
    endpoint("/api/v1/zones", unauthorizedThen(1, []).handler);

    await expect(useApi().request("/zones")).rejects.toBeInstanceOf(SessionExpiredError);

    expect(useRouter().currentRoute.value.fullPath).toBe("/login");
  });

  it("un segundo 401 con el token recién renovado no reintenta en bucle", async () => {
    await signInWithLogin();
    let refreshes = 0;
    endpoint("/api/v1/auth/refresh", {
      method: "POST",
      handler: () => {
        refreshes++;
        return { accessToken: buildToken() };
      },
    });
    const users = unauthorizedThen(Infinity, []);
    endpoint("/api/v1/users", users.handler);

    await expect(useApi().request("/users")).rejects.toBeInstanceOf(SessionExpiredError);

    expect(users.calls()).toBe(2);
    expect(refreshes).toBe(1);
    expect(useSession().expired.value).toBe(true);
  });

  it("un error de la API sale con el mensaje de Nest, también si es una lista de validación", async () => {
    await signInWithLogin();
    endpoint("/api/v1/orders", {
      method: "POST",
      handler: (event) => {
        setResponseStatus(event, 400);
        return { message: ["deliveryDate must be a date", "items should not be empty"] };
      },
    });
    endpoint("/api/v1/orders/o-1", (event) => {
      setResponseStatus(event, 409);
      return { message: "El pedido ya está en ruta" };
    });

    const listError = await useApi()
      .request("/orders", { method: "POST", body: {} })
      .catch((error: unknown) => error);
    const textError = await useApi()
      .request("/orders/o-1")
      .catch((error: unknown) => error);

    expect(listError).toBeInstanceOf(ApiError);
    expect(listError).toMatchObject({
      status: 400,
      message: "deliveryDate must be a date, items should not be empty",
    });
    expect(textError).toMatchObject({ status: 409, message: "El pedido ya está en ruta" });
    expect(describeApiFailure(textError)).toBe("El pedido ya está en ruta");
  });

  it("un error sin mensaje dice el status; un 204 devuelve undefined", async () => {
    await signInWithLogin();
    endpoint("/api/v1/broken", (event) => {
      setResponseStatus(event, 500);
      return "";
    });
    endpoint("/api/v1/customer-prices/p-1", {
      method: "DELETE",
      handler: (event) => {
        setResponseStatus(event, 204);
        return null;
      },
    });

    await expect(useApi().request("/broken")).rejects.toMatchObject({
      status: 500,
      message: "La API respondió 500.",
    });
    await expect(
      useApi().request("/customer-prices/p-1", { method: "DELETE" }),
    ).resolves.toBeUndefined();
  });

  it("un timeout sale como RequestTimeoutError y una red caída pasa tal cual", async () => {
    const raw = vi.spyOn(globalThis.$fetch, "raw");
    raw.mockRejectedValueOnce(
      Object.assign(new Error("timeout"), { cause: { name: "TimeoutError" } }),
    );
    raw.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const timeout = await useApi()
      .request("/zones")
      .catch((error: unknown) => error);
    const offline = await useApi()
      .request("/zones")
      .catch((error: unknown) => error);

    expect(timeout).toBeInstanceOf(RequestTimeoutError);
    expect(describeApiFailure(timeout)).toBe(
      "El servidor no respondió a tiempo. Inténtalo de nuevo.",
    );
    expect(offline).toBeInstanceOf(TypeError);
    expect(describeApiFailure(offline)).toBe(
      "No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.",
    );
  });
});
