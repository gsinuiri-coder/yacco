import type { RouteSnapshot } from "@yacco/shared";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import { App } from "../src/App";
import type { LocationTracker } from "../src/location/location-tracker";
import type { OfflineStore } from "../src/offline/offline-store";
import { createApiClient } from "../src/session/api-client";
import {
  DRIVER,
  DRIVER_REFRESH,
  fakeLocationTracker,
  fakeServer,
  fakeToken,
  memoryOfflineStore,
  memoryStore,
} from "./fakes";

const BASE = "https://api.example.test";
const OFFLINE_TEXT = "Sin conexión con el servidor. Tu sesión sigue abierta.";

function routeWithStop(name: string): RouteSnapshot {
  return {
    route: {
      id: "r-1",
      driverId: DRIVER.id,
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
  locationTracker?: LocationTracker,
) {
  await render(
    <App
      client={createApiClient({ baseUrl: BASE, store, fetchImpl: server.fetchImpl })}
      offlineStore={offlineStore}
      newOperationId={() => "op-1"}
      locationTracker={locationTracker}
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
      { status: 200, body: { accessToken: "access-1", refreshToken: DRIVER_REFRESH } },
      { status: 200, body: DRIVER },
    );
    await renderApp(store, server);
    await screen.findByLabelText("Usuario");

    await fillLogin("  chofer.juan ", "una-clave");

    expect(await screen.findByRole("header", { name: "Hola, chofer.juan" })).toBeOnTheScreen();
    expect(server.calls[0]?.body).toEqual({ username: "chofer.juan", password: "una-clave" });
    expect(store.value).toBe(DRIVER_REFRESH);
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
    await renderApp(memoryStore(DRIVER_REFRESH), server);

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
    await renderApp(memoryStore(DRIVER_REFRESH), server, offlineStore);

    expect(await screen.findByText("1. Bodega Rosita")).toBeOnTheScreen();
    expect(server.calls[2]?.url).toBe(`${BASE}/api/v1/sync/route-snapshot`);
    expect(offlineStore.snapshot?.route.stops[0]?.location.name).toBe("Bodega Rosita");
  });

  it("sin señal entra igual y muestra la ruta que quedó guardada en el celular", async () => {
    const offlineStore = memoryOfflineStore();
    offlineStore.snapshot = routeWithStop("Bodega Rosita");
    await renderApp(
      memoryStore(DRIVER_REFRESH),
      fakeServer(new TypeError("Network request failed")),
      offlineStore,
    );

    expect(await screen.findByText("1. Bodega Rosita")).toBeOnTheScreen();
    expect(screen.getByText("Sin señal: es la ruta guardada en el celular.")).toBeOnTheScreen();
  });

  it("sin señal entra igual: la sesión sigue abierta", async () => {
    const store = memoryStore(DRIVER_REFRESH);
    await renderApp(store, fakeServer(new TypeError("Network request failed")));

    expect(await screen.findByText(OFFLINE_TEXT)).toBeOnTheScreen();
    expect(store.value).toBe(DRIVER_REFRESH);
  });

  it("un error del servidor al abrir tampoco cierra la sesión", async () => {
    const store = memoryStore(DRIVER_REFRESH);
    await renderApp(store, fakeServer({ status: 503 }));

    expect(await screen.findByText(OFFLINE_TEXT)).toBeOnTheScreen();
    expect(store.value).toBe(DRIVER_REFRESH);
  });

  it("si la señal se corta justo después de ingresar, queda adentro igual", async () => {
    const store = memoryStore();
    const server = fakeServer(
      { status: 200, body: { accessToken: "access-1", refreshToken: DRIVER_REFRESH } },
      new TypeError("Network request failed"),
    );
    await renderApp(store, server);
    await screen.findByLabelText("Usuario");

    await fillLogin("chofer.juan", "una-clave");

    expect(await screen.findByText(OFFLINE_TEXT)).toBeOnTheScreen();
    expect(store.value).toBe(DRIVER_REFRESH);
  });

  it("si el administrador cortó la sesión desde «Usuarios», vuelve al ingreso avisando que venció", async () => {
    const store = memoryStore(fakeToken(DRIVER.id, "revocado"));
    await renderApp(
      store,
      fakeServer({ status: 401, body: { message: "Credenciales inválidas" } }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Tu sesión venció. Vuelve a ingresar.",
    );
    expect(store.value).toBeNull();
  });

  it("si la sesión vence mientras baja la ruta, vuelve al ingreso avisando que venció", async () => {
    const store = memoryStore(DRIVER_REFRESH);
    const server = fakeServer(
      { status: 200, body: { accessToken: "access-2" } },
      { status: 200, body: DRIVER },
      { status: 401, body: { message: "Token inválido" } },
      { status: 401, body: { message: "Credenciales inválidas" } },
    );
    await renderApp(store, server);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Tu sesión venció. Vuelve a ingresar.",
    );
    expect(screen.getByRole("button", { name: "Ingresar" })).toBeOnTheScreen();
    expect(store.value).toBeNull();
  });

  it("si le sacaron el rol de chofer, vuelve al ingreso con «Solo choferes»", async () => {
    const store = memoryStore(DRIVER_REFRESH);
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
    const store = memoryStore(DRIVER_REFRESH);
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
    const store = memoryStore(DRIVER_REFRESH);
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

// Decisión de Giancarlo (2026-10-23 08:17): cerrar sesión borra la ruta
// guardada; la cola nunca se borra, queda a nombre de quien la hizo.
describe("cerrar sesión con la ruta y la cola en el celular", () => {
  function queuedMark(id: string) {
    return {
      id,
      type: "STOP_MARK" as const,
      version: 1,
      clientTimestamp: "2026-10-23T14:00:00.000Z",
      payload: { routeId: "r-1", stopId: "s-1", status: "FAILED", failureReason: "Cerrado" },
    };
  }

  /** Entra con la sesión guardada de Juan y sin señal para la ruta ni la cola. */
  async function signedInWith(
    offlineStore: ReturnType<typeof memoryOfflineStore>,
    locationTracker?: LocationTracker,
  ) {
    const store = memoryStore(DRIVER_REFRESH);
    const server = fakeServer(
      { status: 200, body: { accessToken: "access-2" } },
      { status: 200, body: DRIVER },
    );
    await renderApp(store, server, offlineStore, locationTracker);
    await screen.findByText("1. Bodega Rosita");
    return store;
  }

  it("sin pendientes borra la ruta guardada y deja la cola", async () => {
    const offlineStore = memoryOfflineStore();
    offlineStore.snapshot = routeWithStop("Bodega Rosita");
    await offlineStore.addOperation(queuedMark("op-enviada"), DRIVER.id);
    await offlineStore.setOperationState("op-enviada", "SENT", null);
    const store = await signedInWith(offlineStore);

    await fireEvent.press(screen.getByRole("button", { name: "Cerrar sesión" }));

    expect(await screen.findByLabelText("Usuario")).toBeOnTheScreen();
    expect(store.value).toBeNull();
    expect(offlineStore.snapshot).toBeNull();
    expect(offlineStore.operations).toHaveLength(1);
  });

  // Fase 3, fila 11c: sin sesión no hay ruta que seguir, y la notificación
  // fija de la ubicación no puede quedar prendida.
  it("apaga la ubicación en segundo plano", async () => {
    const offlineStore = memoryOfflineStore();
    offlineStore.snapshot = routeWithStop("Bodega Rosita");
    const { tracker } = fakeLocationTracker();
    await signedInWith(offlineStore, tracker);
    expect(tracker.stop).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole("button", { name: "Cerrar sesión" }));

    expect(await screen.findByLabelText("Usuario")).toBeOnTheScreen();
    expect(tracker.stop).toHaveBeenCalledTimes(1);
  });

  it("con pendientes avisa cuántas, deja cancelar o seguir, y no las borra", async () => {
    const offlineStore = memoryOfflineStore();
    offlineStore.snapshot = routeWithStop("Bodega Rosita");
    await offlineStore.addOperation(queuedMark("op-1"), DRIVER.id);
    await offlineStore.addOperation(queuedMark("op-2"), DRIVER.id);
    await offlineStore.addOperation(queuedMark("op-de-otro"), "u-2");
    const store = await signedInWith(offlineStore);
    const warning =
      "Tienes 2 pendientes de enviar; se enviarán cuando vuelvas a entrar. ¿Cerrar sesión igual?";

    await fireEvent.press(screen.getByRole("button", { name: "Cerrar sesión" }));
    expect(await screen.findByText(warning)).toBeOnTheScreen();
    expect(store.value).toBe(DRIVER_REFRESH);

    await fireEvent.press(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByText(warning)).toBeNull();
    expect(offlineStore.snapshot).not.toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "Cerrar sesión" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Cerrar sesión igual" }));

    expect(await screen.findByLabelText("Usuario")).toBeOnTheScreen();
    expect(store.value).toBeNull();
    expect(offlineStore.snapshot).toBeNull();
    expect(offlineStore.operations.map((op) => op.state)).toEqual([
      "PENDING",
      "PENDING",
      "PENDING",
    ]);
  });

  it("con una sola pendiente lo dice en singular", async () => {
    const offlineStore = memoryOfflineStore();
    offlineStore.snapshot = routeWithStop("Bodega Rosita");
    await offlineStore.addOperation(queuedMark("op-1"), DRIVER.id);
    await signedInWith(offlineStore);

    await fireEvent.press(screen.getByRole("button", { name: "Cerrar sesión" }));

    expect(
      await screen.findByText(
        "Tienes 1 pendiente de enviar; se enviará cuando vuelvas a entrar. ¿Cerrar sesión igual?",
      ),
    ).toBeOnTheScreen();
  });

  it("si no se pudo borrar la ruta guardada, no cierra la sesión y deja intentar de nuevo", async () => {
    const offlineStore = memoryOfflineStore();
    offlineStore.snapshot = routeWithStop("Bodega Rosita");
    offlineStore.clearSnapshot = () => Promise.reject(new Error("SQLITE_BUSY"));
    const store = await signedInWith(offlineStore);

    await fireEvent.press(screen.getByRole("button", { name: "Cerrar sesión" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo cerrar la sesión. Inténtalo de nuevo.",
    );
    expect(store.value).toBe(DRIVER_REFRESH);
  });

  it("otro chofer que entra en el mismo celular manda su cola y no la de Juan", async () => {
    const offlineStore = memoryOfflineStore();
    await offlineStore.addOperation(queuedMark("op-de-juan"), DRIVER.id);
    await offlineStore.addOperation(queuedMark("op-de-pedro"), "u-2");
    const pedro = { id: "u-2", username: "chofer.pedro", roles: ["DRIVER" as const] };
    const server = fakeServer(
      { status: 200, body: { accessToken: "access-1", refreshToken: fakeToken(pedro.id) } },
      { status: 200, body: pedro },
      { status: 200, body: routeWithStop("Bodega Lucha") },
      {
        status: 200,
        body: { results: [{ id: "op-de-pedro", status: "APPLIED", quarantined: false }] },
      },
    );
    await renderApp(memoryStore(), server, offlineStore);
    await screen.findByLabelText("Usuario");

    await fillLogin("chofer.pedro", "una-clave");

    expect(await screen.findByText("1. Bodega Lucha")).toBeOnTheScreen();
    await waitFor(() => expect(offlineStore.operations[1]?.state).toBe("SENT"));
    const sync = server.calls.find((call) => call.url === `${BASE}/api/v1/sync/operations`);
    expect(sync?.body).toMatchObject({ operations: [{ id: "op-de-pedro" }] });
    expect((sync?.body as { operations: unknown[] }).operations).toHaveLength(1);
    expect(offlineStore.operations[0]).toMatchObject({ state: "PENDING", driverId: DRIVER.id });
  });
});
