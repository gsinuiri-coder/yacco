import {
  ApiError,
  OfflineError,
  SERVER_FAILURE_MESSAGE,
  SessionExpiredError,
  createApiClient,
} from "../src/session/api-client";
import { DRIVER, fakeServer, fakeToken, memoryStore } from "./fakes";

const BASE = "https://api.example.test";

describe("api client: de quién es la sesión guardada", () => {
  it("lo lee del refresh guardado, también sin señal", async () => {
    const server = fakeServer();
    const client = createApiClient({
      baseUrl: BASE,
      store: memoryStore(fakeToken("u-7")),
      fetchImpl: server.fetchImpl,
    });

    expect(await client.sessionUserId()).toBe("u-7");
    expect(server.calls).toHaveLength(0);
  });

  it.each([
    ["sin sesión", null],
    ["con un refresh ilegible", "no-es-un-token"],
    ["con un cuerpo que no es JSON", "cabecera.%%%.firma"],
    ["sin sub", `cabecera.${btoa(JSON.stringify({ type: "refresh" }))}.firma`],
  ])("%s no inventa un dueño", async (_case, stored) => {
    const client = createApiClient({ baseUrl: BASE, store: memoryStore(stored) });

    expect(await client.sessionUserId()).toBeNull();
  });
});

describe("api client: la sesión de 30 días del celular", () => {
  it("al ingresar guarda el refresh en el almacenamiento seguro y usa el acceso en los pedidos", async () => {
    const store = memoryStore();
    const server = fakeServer(
      { status: 200, body: { accessToken: "access-1", refreshToken: "refresh-1" } },
      { status: 200, body: DRIVER },
    );
    const client = createApiClient({ baseUrl: BASE, store, fetchImpl: server.fetchImpl });

    await client.login({ username: "chofer.juan", password: "una-clave" });
    const me = await client.me();

    expect(store.value).toBe("refresh-1");
    expect(me).toEqual(DRIVER);
    expect(server.calls[0]).toMatchObject({
      url: `${BASE}/api/v1/auth/mobile/login`,
      method: "POST",
      body: { username: "chofer.juan", password: "una-clave" },
    });
    expect(server.calls[1]).toMatchObject({
      url: `${BASE}/api/v1/auth/me`,
      authorization: "Bearer access-1",
    });
  });

  it("un usuario que no es chofer recibe 403 y no guarda nada", async () => {
    const store = memoryStore();
    const server = fakeServer({ status: 403, body: { message: "La app es solo para choferes" } });
    const client = createApiClient({ baseUrl: BASE, store, fetchImpl: server.fetchImpl });

    const failure = client.login({ username: "oficina", password: "una-clave" });

    await expect(failure).rejects.toEqual(new ApiError(403, "La app es solo para choferes"));
    expect(store.value).toBeNull();
  });

  it("al abrir la app renueva el acceso mandando el refresh guardado en el cuerpo", async () => {
    const store = memoryStore("refresh-guardado");
    const server = fakeServer(
      { status: 200, body: { accessToken: "access-2" } },
      { status: 200, body: DRIVER },
    );
    const client = createApiClient({ baseUrl: BASE, store, fetchImpl: server.fetchImpl });

    expect(await client.hasStoredSession()).toBe(true);
    await client.me();

    expect(server.calls[0]).toMatchObject({
      url: `${BASE}/api/v1/auth/mobile/refresh`,
      method: "POST",
      authorization: null,
      body: { refreshToken: "refresh-guardado" },
    });
    expect(server.calls[1]?.authorization).toBe("Bearer access-2");
  });

  it("un acceso vencido (401) se renueva una vez y el pedido se repite", async () => {
    const store = memoryStore();
    const server = fakeServer(
      { status: 200, body: { accessToken: "access-viejo", refreshToken: "refresh-1" } },
      { status: 401, body: { message: "Unauthorized" } },
      { status: 200, body: { accessToken: "access-nuevo" } },
      { status: 200, body: DRIVER },
    );
    const client = createApiClient({ baseUrl: BASE, store, fetchImpl: server.fetchImpl });
    await client.login({ username: "chofer.juan", password: "una-clave" });

    await expect(client.me()).resolves.toEqual(DRIVER);
    expect(server.calls.map((call) => call.authorization)).toEqual([
      null,
      "Bearer access-viejo",
      null,
      "Bearer access-nuevo",
    ]);
  });

  it("dos pedidos al abrir la app, sin acceso todavía, comparten una sola renovación", async () => {
    const store = memoryStore("refresh-guardado");
    const server = fakeServer(
      { status: 200, body: { accessToken: "access-3" } },
      { status: 200, body: DRIVER },
      { status: 200, body: DRIVER },
    );
    const client = createApiClient({ baseUrl: BASE, store, fetchImpl: server.fetchImpl });

    await Promise.all([client.me(), client.me()]);

    const refreshes = server.calls.filter((call) => call.url.endsWith("/auth/mobile/refresh"));
    expect(refreshes).toHaveLength(1);
  });

  it("dos pedidos que reciben 401 a la vez comparten una sola renovación", async () => {
    const store = memoryStore();
    const server = fakeServer(
      { status: 200, body: { accessToken: "access-viejo", refreshToken: "refresh-1" } },
      { status: 401 },
      { status: 401 },
      { status: 200, body: { accessToken: "access-nuevo" } },
      { status: 200, body: DRIVER },
      { status: 200, body: DRIVER },
    );
    const client = createApiClient({ baseUrl: BASE, store, fetchImpl: server.fetchImpl });
    await client.login({ username: "chofer.juan", password: "una-clave" });

    await Promise.all([client.me(), client.me()]);

    const refreshes = server.calls.filter((call) => call.url.endsWith("/auth/mobile/refresh"));
    expect(refreshes).toHaveLength(1);
    expect(server.calls.slice(-2).map((call) => call.authorization)).toEqual([
      "Bearer access-nuevo",
      "Bearer access-nuevo",
    ]);
  });

  it("si el administrador cortó la sesión desde «Usuarios», el refresh da 401 y el celular la olvida", async () => {
    const store = memoryStore("refresh-revocado");
    const server = fakeServer({ status: 401, body: { message: "Credenciales inválidas" } });
    const client = createApiClient({ baseUrl: BASE, store, fetchImpl: server.fetchImpl });

    await expect(client.me()).rejects.toEqual(new SessionExpiredError("expired"));
    expect(store.value).toBeNull();
    expect(await client.hasStoredSession()).toBe(false);
  });

  it("si en estos 30 días le sacaron el rol de chofer, el refresh da 403 y el celular la olvida", async () => {
    const store = memoryStore("refresh-guardado");
    const server = fakeServer({ status: 403, body: { message: "La app es solo para choferes" } });
    const client = createApiClient({ baseUrl: BASE, store, fetchImpl: server.fetchImpl });

    const failure = await client.me().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SessionExpiredError);
    expect((failure as SessionExpiredError).reason).toBe("driversOnly");
    expect(store.value).toBeNull();
  });

  it("una renovación que vuelve después de cerrar sesión no deja un acceso vivo", async () => {
    const store = memoryStore("refresh-guardado");
    let answerRefresh: (response: Response) => void = () => undefined;
    const fetchImpl = jest.fn(
      () =>
        new Promise<Response>((resolve) => {
          answerRefresh = resolve;
        }),
    ) as unknown as typeof fetch;
    const client = createApiClient({ baseUrl: BASE, store, fetchImpl });

    const pending = client.me();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await client.logout();
    answerRefresh(new Response(JSON.stringify({ accessToken: "access-tarde" }), { status: 200 }));

    await expect(pending).rejects.toBeInstanceOf(SessionExpiredError);
    await expect(client.me()).rejects.toBeInstanceOf(SessionExpiredError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("sin refresh guardado no hay a qué renovar: la sesión venció", async () => {
    const server = fakeServer();
    const client = createApiClient({
      baseUrl: BASE,
      store: memoryStore(),
      fetchImpl: server.fetchImpl,
    });

    await expect(client.me()).rejects.toBeInstanceOf(SessionExpiredError);
    expect(server.calls).toHaveLength(0);
  });

  it("sin señal el refresh NO se borra: la sesión sigue para cuando vuelva la conexión", async () => {
    const store = memoryStore("refresh-guardado");
    const server = fakeServer(new TypeError("Network request failed"));
    const client = createApiClient({ baseUrl: BASE, store, fetchImpl: server.fetchImpl });

    await expect(client.me()).rejects.toBeInstanceOf(OfflineError);
    expect(store.value).toBe("refresh-guardado");
  });

  it("un error del servidor en el refresh no borra la sesión", async () => {
    const store = memoryStore("refresh-guardado");
    const server = fakeServer({ status: 503 });
    const client = createApiClient({ baseUrl: BASE, store, fetchImpl: server.fetchImpl });

    await expect(client.me()).rejects.toEqual(new ApiError(503, SERVER_FAILURE_MESSAGE));
    expect(store.value).toBe("refresh-guardado");
  });

  it("un 5xx muestra el aviso en castellano, no el texto del servidor", async () => {
    const server = fakeServer({ status: 500, body: { message: "Internal server error" } });
    const client = createApiClient({
      baseUrl: BASE,
      store: memoryStore(),
      fetchImpl: server.fetchImpl,
    });

    await expect(client.login({ username: "chofer.juan", password: "una-clave" })).rejects.toEqual(
      new ApiError(500, SERVER_FAILURE_MESSAGE),
    );
  });

  it("un error sin cuerpo dice el status", async () => {
    const server = fakeServer({ status: 200, body: { accessToken: "access-1" } }, { status: 404 });
    const client = createApiClient({
      baseUrl: BASE,
      store: memoryStore("refresh-guardado"),
      fetchImpl: server.fetchImpl,
    });

    await expect(client.request("/algo")).rejects.toEqual(
      new ApiError(404, "El servidor respondió 404."),
    );
  });

  it("los mensajes de validación de la API llegan juntos", async () => {
    const server = fakeServer({
      status: 400,
      body: { message: ["falta el usuario", "falta la clave"] },
    });
    const client = createApiClient({
      baseUrl: BASE,
      store: memoryStore(),
      fetchImpl: server.fetchImpl,
    });

    await expect(client.login({ username: "", password: "" })).rejects.toEqual(
      new ApiError(400, "falta el usuario falta la clave"),
    );
  });

  it("una respuesta 204 no tiene cuerpo que leer", async () => {
    const server = fakeServer({ status: 200, body: { accessToken: "access-1" } }, { status: 204 });
    const client = createApiClient({
      baseUrl: BASE,
      store: memoryStore("refresh-guardado"),
      fetchImpl: server.fetchImpl,
    });

    await expect(client.request("/algo", { method: "POST" })).resolves.toBeUndefined();
  });

  it("cerrar sesión borra el refresh del celular y el próximo pedido ya no tiene sesión", async () => {
    const store = memoryStore();
    const server = fakeServer({
      status: 200,
      body: { accessToken: "access-1", refreshToken: "refresh-1" },
    });
    const client = createApiClient({ baseUrl: BASE, store, fetchImpl: server.fetchImpl });
    await client.login({ username: "chofer.juan", password: "una-clave" });

    await client.logout();

    expect(store.value).toBeNull();
    await expect(client.me()).rejects.toBeInstanceOf(SessionExpiredError);
  });
});
