import {
  ApiError,
  OfflineError,
  SessionExpiredError,
  createApiClient,
} from "../src/session/api-client";
import { DRIVER, fakeServer, memoryStore } from "./fakes";

const BASE = "https://api.example.test";

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

  it("dos pedidos que encuentran el acceso vencido comparten una sola renovación", async () => {
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

  it("si el administrador cortó la sesión desde «Usuarios», el refresh da 401 y el celular la olvida", async () => {
    const store = memoryStore("refresh-revocado");
    const server = fakeServer({ status: 401, body: { message: "Credenciales inválidas" } });
    const client = createApiClient({ baseUrl: BASE, store, fetchImpl: server.fetchImpl });

    await expect(client.me()).rejects.toBeInstanceOf(SessionExpiredError);
    expect(store.value).toBeNull();
    expect(await client.hasStoredSession()).toBe(false);
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

    await expect(client.me()).rejects.toEqual(new ApiError(503, "El servidor respondió 503."));
    expect(store.value).toBe("refresh-guardado");
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
