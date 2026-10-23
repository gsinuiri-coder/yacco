import type { RouteSnapshot } from "@yacco/shared";
import { fireEvent, render, screen } from "@testing-library/react-native";

import { App } from "../src/App";
import type { OfflineStore } from "../src/offline/offline-store";
import { createOutbox } from "../src/offline/outbox";
import { createApiClient } from "../src/session/api-client";
import { DRIVER, fakeServer, memoryOfflineStore, memoryStore } from "./fakes";

const BASE = "https://api.example.test";
const OFFLINE_TEXT = "Sin conexión con el servidor. Tu sesión sigue abierta.";

function routeWithStop(name: string): RouteSnapshot {
  return {
    route: {
      id: "r-1",
      stops: [
        {
          id: "s-1",
          position: 1,
          origin: "ORDER",
          status: "PENDING",
          location: { id: "l-1", name, address: "Jr. Lima 120", customer: { id: "c-1", name } },
        },
      ],
    },
    locations: [],
    orders: [],
    products: [],
    containerTypes: [],
    paymentMethods: [],
  } as unknown as RouteSnapshot;
}

async function renderApp(
  store: ReturnType<typeof memoryStore>,
  server: ReturnType<typeof fakeServer>,
  offlineStore: OfflineStore = memoryOfflineStore(),
) {
  await render(
    <App
      client={createApiClient({ baseUrl: BASE, store, fetchImpl: server.fetchImpl })}
      offlineStore={offlineStore}
      outbox={createOutbox({ store: offlineStore, newId: () => "op-1" })}
    />,
  );
}

async function fillLogin(username: string, password: string) {
  await fireEvent.changeText(screen.getByLabelText("Usuario"), username);
  await fireEvent.changeText(screen.getByLabelText("Contraseña"), password);
  await fireEvent.press(screen.getByRole("button", { name: "Ingresar" }));
}

describe("ingreso del chofer", () => {
  it("sin sesión guardada pide usuario y contraseña, y al ingresar saluda al chofer", async () => {
    const store = memoryStore();
    const server = fakeServer(
      { status: 200, body: { accessToken: "access-1", refreshToken: "refresh-1" } },
      { status: 200, body: DRIVER },
    );
    await renderApp(store, server);
    await screen.findByLabelText("Usuario");

    await fillLogin("  chofer.juan ", "una-clave");

    expect(await screen.findByRole("header", { name: "Hola, chofer.juan" })).toBeOnTheScreen();
    expect(server.calls[0]?.body).toEqual({ username: "chofer.juan", password: "una-clave" });
    expect(store.value).toBe("refresh-1");
  });

  it("sin usuario o contraseña avisa y no llama al servidor", async () => {
    const server = fakeServer();
    await renderApp(memoryStore(), server);
    await screen.findByLabelText("Usuario");

    await fillLogin("chofer.juan", "");

    expect(screen.getByRole("alert")).toHaveTextContent("Ingresa usuario y contraseña.");
    expect(server.calls).toHaveLength(0);
  });

  it("con la contraseña equivocada no dice si el usuario existe", async () => {
    const server = fakeServer({ status: 401, body: { message: "Credenciales inválidas" } });
    await renderApp(memoryStore(), server);
    await screen.findByLabelText("Usuario");

    await fillLogin("chofer.juan", "otra-clave");

    expect(await screen.findByRole("alert")).toHaveTextContent("Usuario o contraseña incorrectos.");
  });

  it("un usuario de oficina ve «Solo choferes» y queda en el ingreso", async () => {
    const store = memoryStore();
    const server = fakeServer({ status: 403, body: { message: "La app es solo para choferes" } });
    await renderApp(store, server);
    await screen.findByLabelText("Usuario");

    await fillLogin("oficina", "una-clave");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Solo choferes. La oficina entra por la web.",
    );
    expect(screen.getByRole("button", { name: "Ingresar" })).toBeOnTheScreen();
    expect(store.value).toBeNull();
  });

  it("sin señal al ingresar pide revisar la señal", async () => {
    const server = fakeServer(new TypeError("Network request failed"));
    await renderApp(memoryStore(), server);
    await screen.findByLabelText("Usuario");

    await fillLogin("chofer.juan", "una-clave");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo conectar con el servidor. Revisa tu señal e inténtalo de nuevo.",
    );
  });

  it("otro error del servidor muestra su mensaje", async () => {
    const server = fakeServer({ status: 429, body: { message: "Demasiados intentos" } });
    await renderApp(memoryStore(), server);
    await screen.findByLabelText("Usuario");

    await fillLogin("chofer.juan", "una-clave");

    expect(await screen.findByRole("alert")).toHaveTextContent("Demasiados intentos");
  });
});

describe("la sesión de 30 días al abrir la app", () => {
  it("con un refresh guardado entra directo, sin pedir la contraseña", async () => {
    const server = fakeServer(
      { status: 200, body: { accessToken: "access-2" } },
      { status: 200, body: DRIVER },
    );
    await renderApp(memoryStore("refresh-guardado"), server);

    expect(await screen.findByRole("header", { name: "Hola, chofer.juan" })).toBeOnTheScreen();
    expect(screen.queryByLabelText("Contraseña")).toBeNull();
  });

  it("al entrar baja la ruta del día y muestra sus paradas", async () => {
    const offlineStore = memoryOfflineStore();
    const server = fakeServer(
      { status: 200, body: { accessToken: "access-2" } },
      { status: 200, body: DRIVER },
      { status: 200, body: routeWithStop("Bodega Rosita") },
    );
    await renderApp(memoryStore("refresh-guardado"), server, offlineStore);

    expect(await screen.findByText("1. Bodega Rosita")).toBeOnTheScreen();
    expect(server.calls[2]?.url).toBe(`${BASE}/api/v1/sync/route-snapshot`);
    expect(offlineStore.snapshot?.route.stops[0]?.location.name).toBe("Bodega Rosita");
  });

  it("sin señal entra igual y muestra la ruta que quedó guardada en el celular", async () => {
    const offlineStore = memoryOfflineStore();
    offlineStore.snapshot = routeWithStop("Bodega Rosita");
    await renderApp(
      memoryStore("refresh-guardado"),
      fakeServer(new TypeError("Network request failed")),
      offlineStore,
    );

    expect(await screen.findByText("1. Bodega Rosita")).toBeOnTheScreen();
    expect(screen.getByText("Sin señal: es la ruta guardada en el celular.")).toBeOnTheScreen();
  });

  it("sin señal entra igual: la sesión sigue abierta", async () => {
    const store = memoryStore("refresh-guardado");
    await renderApp(store, fakeServer(new TypeError("Network request failed")));

    expect(await screen.findByText(OFFLINE_TEXT)).toBeOnTheScreen();
    expect(store.value).toBe("refresh-guardado");
  });

  it("un error del servidor al abrir tampoco cierra la sesión", async () => {
    const store = memoryStore("refresh-guardado");
    await renderApp(store, fakeServer({ status: 503 }));

    expect(await screen.findByText(OFFLINE_TEXT)).toBeOnTheScreen();
    expect(store.value).toBe("refresh-guardado");
  });

  it("si la señal se corta justo después de ingresar, queda adentro igual", async () => {
    const store = memoryStore();
    const server = fakeServer(
      { status: 200, body: { accessToken: "access-1", refreshToken: "refresh-1" } },
      new TypeError("Network request failed"),
    );
    await renderApp(store, server);
    await screen.findByLabelText("Usuario");

    await fillLogin("chofer.juan", "una-clave");

    expect(await screen.findByText(OFFLINE_TEXT)).toBeOnTheScreen();
    expect(store.value).toBe("refresh-1");
  });

  it("si el administrador cortó la sesión desde «Usuarios», vuelve al ingreso avisando que venció", async () => {
    const store = memoryStore("refresh-revocado");
    await renderApp(
      store,
      fakeServer({ status: 401, body: { message: "Credenciales inválidas" } }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Tu sesión venció. Vuelve a ingresar.",
    );
    expect(store.value).toBeNull();
  });

  it("si le sacaron el rol de chofer, vuelve al ingreso con «Solo choferes»", async () => {
    const store = memoryStore("refresh-guardado");
    await renderApp(
      store,
      fakeServer({ status: 403, body: { message: "La app es solo para choferes" } }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Solo choferes. La oficina entra por la web.",
    );
    expect(store.value).toBeNull();
  });

  it("si el almacenamiento seguro no se puede leer, pide ingresar sin avisos", async () => {
    const store = memoryStore();
    store.read = () => Promise.reject(new Error("Keystore no disponible"));
    await renderApp(store, fakeServer());

    expect(await screen.findByRole("button", { name: "Ingresar" })).toBeOnTheScreen();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("si no se pudo borrar el refresh, avisa y deja intentar de nuevo", async () => {
    const store = memoryStore("refresh-guardado");
    store.clear = () => Promise.reject(new Error("Keystore no disponible"));
    const server = fakeServer(
      { status: 200, body: { accessToken: "access-2" } },
      { status: 200, body: DRIVER },
    );
    await renderApp(store, server);
    await screen.findByRole("header", { name: "Hola, chofer.juan" });

    await fireEvent.press(screen.getByRole("button", { name: "Cerrar sesión" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo cerrar la sesión. Inténtalo de nuevo.",
    );
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeEnabled();
  });

  it("cerrar sesión borra el refresh y vuelve al ingreso sin el aviso de vencida", async () => {
    const store = memoryStore("refresh-guardado");
    const server = fakeServer(
      { status: 200, body: { accessToken: "access-2" } },
      { status: 200, body: DRIVER },
    );
    await renderApp(store, server);
    await screen.findByRole("header", { name: "Hola, chofer.juan" });

    await fireEvent.press(screen.getByRole("button", { name: "Cerrar sesión" }));

    expect(await screen.findByLabelText("Usuario")).toBeOnTheScreen();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(store.value).toBeNull();
  });
});
