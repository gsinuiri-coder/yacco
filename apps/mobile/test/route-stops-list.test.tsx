import type {
  RouteSnapshot,
  RouteStatus,
  RouteStop,
  SyncBatchBody,
  SyncBatchResult,
} from "@yacco/shared";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";

import type { OfflineStore } from "../src/offline/offline-store";
import { createOutbox } from "../src/offline/outbox";
import { RouteStopsList, SEND_RETRY_INTERVAL_MS } from "../src/screens/RouteStopsList";
import {
  ApiError,
  OfflineError,
  SessionExpiredError,
  type ApiClient,
} from "../src/session/api-client";
import { deliveryCatalog, memoryOfflineStore } from "./fakes";

function stop(position: number, name: string, overrides: Partial<RouteStop> = {}): RouteStop {
  return {
    id: `stop-${position}`,
    position,
    origin: "ORDER",
    status: "PENDING",
    location: {
      id: `loc-${position}`,
      name,
      address: `Av. Los Olivos ${position}00`,
      customer: { id: `c-${position}`, name: `Cliente ${position}` },
    },
    ...overrides,
  } as RouteStop;
}

function snapshotWith(...stops: RouteStop[]): RouteSnapshot {
  return snapshotOf("PLANNED", ...stops);
}

function snapshotOf(status: RouteStatus, ...stops: RouteStop[]): RouteSnapshot {
  return {
    route: { id: "r-1", driverId: "u-1", status, stops },
    locations: [],
    orders: [],
    products: [],
    containerTypes: [],
    paymentMethods: [],
  } as unknown as RouteSnapshot;
}

type SyncReply = SyncBatchResult | Error | ((body: SyncBatchBody) => SyncBatchResult);

/**
 * El servidor visto por la lista: la ruta del día y el envío de la cola, cada
 * uno con su respuesta. Anota cada lote que le llegó.
 */
function fakeClient(snapshot: RouteSnapshot | Error, sync: SyncReply = new Error("sin envío")) {
  const batches: SyncBatchBody[] = [];
  const client = {
    request: jest.fn(async (path: string, init?: RequestInit) => {
      if (path.startsWith("/sync/route-snapshot")) {
        if (snapshot instanceof Error) throw snapshot;
        return snapshot;
      }
      if (path === "/sync/operations" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as SyncBatchBody;
        batches.push(body);
        if (sync instanceof Error) throw sync;
        return typeof sync === "function" ? sync(body) : sync;
      }
      throw new Error(`Pedido no esperado: ${path}`);
    }),
  } as unknown as ApiClient;
  return { client, batches };
}

async function renderList(client: ApiClient, store: OfflineStore) {
  let next = 0;
  const outbox = createOutbox({ store, driverId: "u-1", newId: () => `op-${++next}` });
  await render(<RouteStopsList client={client} store={store} outbox={outbox} driverId="u-1" />);
}

const OFFLINE = new OfflineError(new TypeError("Network request failed"));

describe("las paradas de la ruta en el celular", () => {
  it("con señal muestra las paradas del servidor, con su estado, sin el aviso de guardada", async () => {
    const store = memoryOfflineStore();
    store.snapshot = snapshotWith(stop(1, "Bodega de ayer"));
    const today = snapshotWith(
      stop(1, "Bodega Rosita"),
      stop(2, "Restaurante El Sol", { status: "DELIVERED", origin: "VAN_SALE" }),
    );

    await renderList(fakeClient(today).client, store);

    expect(await screen.findByText("1. Bodega Rosita")).toBeOnTheScreen();
    expect(screen.getByText("Pendiente")).toBeOnTheScreen();
    expect(screen.getByText("Entregada · Venta en ruta")).toBeOnTheScreen();
    expect(screen.getByText("Cliente 2")).toBeOnTheScreen();
    expect(screen.queryByText("1. Bodega de ayer")).toBeNull();
    expect(screen.queryByText(/ruta guardada en el celular/)).toBeNull();
  });

  it("sin señal muestra la ruta guardada en el celular y lo avisa", async () => {
    const store = memoryOfflineStore();
    store.snapshot = snapshotWith(stop(1, "Bodega Rosita", { status: "FAILED" }));

    await renderList(fakeClient(OFFLINE).client, store);

    expect(await screen.findByText("1. Bodega Rosita")).toBeOnTheScreen();
    expect(screen.getByText("No entregada")).toBeOnTheScreen();
    expect(screen.getByText("Sin señal: es la ruta guardada en el celular.")).toBeOnTheScreen();
  });

  it("sin señal y sin nada guardado pide conectarse", async () => {
    await renderList(fakeClient(OFFLINE).client, memoryOfflineStore());

    expect(
      await screen.findByText(
        "Sin señal y sin una ruta guardada en el celular. Conéctate para bajar tu ruta.",
      ),
    ).toBeOnTheScreen();
  });

  it("si el servidor dice que no tiene ruta, lo muestra en vez de la guardada", async () => {
    const store = memoryOfflineStore();
    store.snapshot = snapshotWith(stop(1, "Bodega de ayer"));
    const notFound = new ApiError(404, "No tienes una ruta para hoy");

    await renderList(fakeClient(notFound).client, store);

    expect(await screen.findByRole("alert")).toHaveTextContent("No tienes una ruta para hoy");
    expect(screen.queryByText("1. Bodega de ayer")).toBeNull();
  });

  it("si falla la base del celular, avisa sin detalles técnicos", async () => {
    const store = memoryOfflineStore();
    store.saveSnapshot = () => Promise.reject(new Error("SQLITE_FULL"));

    await renderList(fakeClient(snapshotWith()).client, store);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo abrir la ruta. Inténtalo de nuevo.",
    );
  });

  it("si la sesión vence al mandar la cola, lo avisa para volver al ingreso y no pierde nada", async () => {
    const store = memoryOfflineStore();
    await store.addOperation(
      {
        id: "op-1",
        type: "STOP_MARK",
        version: 1,
        clientTimestamp: "2026-10-23T14:00:00.000Z",
        payload: { routeId: "r-1", stopId: "stop-1", status: "FAILED", failureReason: "Cerrado" },
      },
      "u-1",
    );
    const expired = new SessionExpiredError();
    const onSessionExpired = jest.fn();
    const outbox = createOutbox({ store, driverId: "u-1", newId: () => "op-2" });

    await render(
      <RouteStopsList
        client={fakeClient(snapshotOf("IN_PROGRESS", stop(1, "Bodega Rosita")), expired).client}
        store={store}
        outbox={outbox}
        driverId="u-1"
        onSessionExpired={onSessionExpired}
      />,
    );

    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledWith(expired));
    expect(store.operations[0]?.state).toBe("PENDING");
  });

  it("una ruta sin paradas lo dice", async () => {
    await renderList(fakeClient(snapshotWith()).client, memoryOfflineStore());

    expect(await screen.findByText("Tu ruta no tiene paradas.")).toBeOnTheScreen();
  });
});

async function failStop(reason: string) {
  const card = await screen.findByLabelText("Parada 1");
  await fireEvent.press(within(card).getByRole("button", { name: "No se pudo entregar" }));
  await fireEvent.changeText(screen.getByLabelText("Por qué no se pudo entregar"), reason);
  await fireEvent.press(screen.getByRole("button", { name: "Guardar" }));
}

describe("marcar una parada como no entregada", () => {
  it("sin señal queda en el celular como «Pendiente de enviar»", async () => {
    const store = memoryOfflineStore();
    store.snapshot = snapshotOf("IN_PROGRESS", stop(1, "Bodega Rosita"), stop(2, "Bodega Lucha"));

    await renderList(fakeClient(OFFLINE, OFFLINE).client, store);
    await failStop("  Local cerrado ");

    expect(await screen.findByText("No entregada · Pendiente de enviar")).toBeOnTheScreen();
    // La otra parada no cambia.
    expect(screen.getByText("Pendiente")).toBeOnTheScreen();
    expect(store.operations).toHaveLength(1);
    expect(store.operations[0]).toMatchObject({
      state: "PENDING",
      envelope: {
        id: "op-1",
        type: "STOP_MARK",
        version: 1,
        payload: {
          routeId: "r-1",
          stopId: "stop-1",
          status: "FAILED",
          failureReason: "Local cerrado",
        },
      },
    });
  });

  it("con señal la manda y queda «Enviada»", async () => {
    const store = memoryOfflineStore();
    const route = snapshotOf("IN_PROGRESS", stop(1, "Bodega Rosita"));
    const server = fakeClient(route, (body) => ({
      results: body.operations.map((op) => ({ id: op.id, status: "APPLIED", quarantined: false })),
    }));

    await renderList(server.client, store);
    await failStop("No había nadie");

    expect(await screen.findByText("No entregada · Enviada")).toBeOnTheScreen();
    expect(server.batches).toHaveLength(1);
    expect(server.batches[0]?.operations.map((op) => op.id)).toEqual(["op-1"]);
    expect(store.operations[0]?.state).toBe("SENT");
  });

  it("si choca con la oficina, la parada queda como la tiene el servidor y «La oficina la revisa»", async () => {
    const store = memoryOfflineStore();
    const route = snapshotOf("IN_PROGRESS", stop(1, "Bodega Rosita"));
    const server = fakeClient(route, (body) => ({
      results: body.operations.map((op) => ({
        id: op.id,
        status: "REJECTED",
        quarantined: true,
        reason: "La parada ya fue marcada",
      })),
    }));

    await renderList(server.client, store);
    await failStop("Local cerrado");

    expect(await screen.findByText("Pendiente · La oficina la revisa")).toBeOnTheScreen();
    expect(screen.getByText("La parada ya fue marcada")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "No se pudo entregar" })).toBeNull();
  });

  it("al abrir con señal manda lo que quedó pendiente en el celular", async () => {
    const store = memoryOfflineStore();
    const route = snapshotOf("IN_PROGRESS", stop(1, "Bodega Rosita"));
    await store.addOperation(
      {
        id: "op-de-ayer",
        type: "STOP_MARK",
        version: 1,
        clientTimestamp: "2026-10-23T14:00:00.000Z",
        payload: { routeId: "r-1", stopId: "stop-1", status: "FAILED", failureReason: "Cerrado" },
      },
      "u-1",
    );
    const server = fakeClient(route, (body) => ({
      results: body.operations.map((op) => ({ id: op.id, status: "APPLIED", quarantined: false })),
    }));

    await renderList(server.client, store);

    expect(await screen.findByText("No entregada · Enviada")).toBeOnTheScreen();
    expect(server.batches[0]?.operations.map((op) => op.id)).toEqual(["op-de-ayer"]);
  });

  describe("cuando vuelve la señal", () => {
    /** Sin señal hasta que el test la devuelve; después el servidor aplica todo. */
    function serverWithoutSignal() {
      let online = false;
      const server = fakeClient(snapshotOf("IN_PROGRESS", stop(1, "Bodega Rosita")), (body) => {
        if (!online) throw OFFLINE;
        return {
          results: body.operations.map((op) => ({
            id: op.id,
            status: "APPLIED",
            quarantined: false,
          })),
        };
      });
      return { ...server, signalBack: () => (online = true) };
    }

    afterEach(() => {
      jest.useRealTimers();
      jest.restoreAllMocks();
    });

    it("la manda sola al rato, sin que el chofer haga nada", async () => {
      jest.useFakeTimers();
      const store = memoryOfflineStore();
      const server = serverWithoutSignal();

      await renderList(server.client, store);
      await failStop("Local cerrado");
      expect(await screen.findByText("No entregada · Pendiente de enviar")).toBeOnTheScreen();

      server.signalBack();
      await act(() => jest.advanceTimersByTimeAsync(SEND_RETRY_INTERVAL_MS));

      expect(await screen.findByText("No entregada · Enviada")).toBeOnTheScreen();
      expect(store.operations[0]?.state).toBe("SENT");
    });

    it("la manda al volver a la app", async () => {
      let onChange: ((state: AppStateStatus) => void) | undefined;
      jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
        onChange = listener;
        return { remove: jest.fn() };
      });
      const store = memoryOfflineStore();
      const server = serverWithoutSignal();

      await renderList(server.client, store);
      await failStop("Local cerrado");
      expect(await screen.findByText("No entregada · Pendiente de enviar")).toBeOnTheScreen();

      server.signalBack();
      await act(async () => onChange?.("active"));

      expect(await screen.findByText("No entregada · Enviada")).toBeOnTheScreen();
    });
  });

  it("sin motivo avisa y no guarda nada", async () => {
    const store = memoryOfflineStore();
    store.snapshot = snapshotOf("IN_PROGRESS", stop(1, "Bodega Rosita"));

    await renderList(fakeClient(OFFLINE).client, store);
    await failStop("   ");

    expect(screen.getByRole("alert")).toHaveTextContent("Escribe por qué no se pudo entregar");
    expect(store.operations).toHaveLength(0);

    await fireEvent.press(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByLabelText("Por qué no se pudo entregar")).toBeNull();
  });

  it("si el celular no la pudo guardar, lo dice y deja reintentar", async () => {
    const store = memoryOfflineStore();
    store.snapshot = snapshotOf("IN_PROGRESS", stop(1, "Bodega Rosita"));
    store.addOperation = () => Promise.reject(new Error("SQLITE_FULL"));

    await renderList(fakeClient(OFFLINE).client, store);
    await failStop("Local cerrado");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo guardar en el celular. Inténtalo de nuevo.",
    );
    expect(screen.getByRole("button", { name: "Guardar" })).toBeOnTheScreen();
  });

  it("con la ruta sin empezar no se marcan paradas, igual que en la web", async () => {
    const store = memoryOfflineStore();
    store.snapshot = snapshotWith(stop(1, "Bodega Rosita"));

    await renderList(fakeClient(OFFLINE).client, store);

    expect(await screen.findByText("1. Bodega Rosita")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "No se pudo entregar" })).toBeNull();
  });
});

// Decisión de Giancarlo (2026-10-23 08:17): el chofer empieza la ruta desde
// la app, también sin señal; la oficina puede haberla empezado o terminado.
describe("empezar la ruta", () => {
  const startRoute = async () =>
    fireEvent.press(await screen.findByRole("button", { name: "Empezar la ruta" }));

  it("sin señal la empieza en el celular, queda «Pendiente de enviar» y ya se marcan paradas", async () => {
    const store = memoryOfflineStore();
    store.snapshot = snapshotWith(stop(1, "Bodega Rosita"));

    await renderList(fakeClient(OFFLINE, OFFLINE).client, store);
    await startRoute();

    expect(await screen.findByText("Ruta en curso · Pendiente de enviar")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Empezar la ruta" })).toBeNull();
    expect(screen.getByRole("button", { name: "No se pudo entregar" })).toBeOnTheScreen();
    expect(store.operations).toHaveLength(1);
    expect(store.operations[0]?.envelope).toMatchObject({
      type: "ROUTE_START",
      version: 1,
      payload: { routeId: "r-1" },
    });
  });

  it("con señal la manda y queda «Enviada»", async () => {
    const store = memoryOfflineStore();
    const server = fakeClient(snapshotWith(stop(1, "Bodega Rosita")), (body) => ({
      results: body.operations.map((op) => ({ id: op.id, status: "APPLIED", quarantined: false })),
    }));

    await renderList(server.client, store);
    await startRoute();

    expect(await screen.findByText("Ruta en curso · Enviada")).toBeOnTheScreen();
    expect(server.batches[0]?.operations.map((op) => op.type)).toEqual(["ROUTE_START"]);
  });

  it("si la oficina ya la terminó, queda como la tiene el servidor y «La oficina la revisa»", async () => {
    const store = memoryOfflineStore();
    const server = fakeClient(snapshotWith(stop(1, "Bodega Rosita")), (body) => ({
      results: body.operations.map((op) => ({
        id: op.id,
        status: "REJECTED",
        quarantined: true,
        reason: "Solo se puede iniciar una ruta planificada; esta está terminada",
      })),
    }));

    await renderList(server.client, store);
    await startRoute();

    // Sin repetir el estado de la ruta guardada, que el motivo contradice.
    expect(await screen.findByText("Empezar la ruta · La oficina la revisa")).toBeOnTheScreen();
    expect(screen.queryByText(/Ruta planificada/)).toBeNull();
    expect(
      screen.getByText("Solo se puede iniciar una ruta planificada; esta está terminada"),
    ).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Empezar la ruta" })).toBeNull();
    expect(screen.queryByRole("button", { name: "No se pudo entregar" })).toBeNull();
  });

  it("una ruta que ya está en curso no ofrece empezarla", async () => {
    await renderList(
      fakeClient(snapshotOf("IN_PROGRESS", stop(1, "Bodega Rosita")), OFFLINE).client,
      memoryOfflineStore(),
    );

    expect(await screen.findByText("1. Bodega Rosita")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Empezar la ruta" })).toBeNull();
  });

  it("si el celular no lo pudo guardar, lo dice y deja reintentar", async () => {
    const store = memoryOfflineStore();
    store.snapshot = snapshotWith(stop(1, "Bodega Rosita"));
    store.addOperation = () => Promise.reject(new Error("SQLITE_FULL"));

    await renderList(fakeClient(OFFLINE).client, store);
    await startRoute();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo guardar en el celular. Inténtalo de nuevo.",
    );
    expect(screen.getByRole("button", { name: "Empezar la ruta" })).toBeOnTheScreen();
  });
});

/** La ruta en curso con la parada de Bodega Rosita, que pidió 3 recargas. */
function deliverySnapshot(): RouteSnapshot {
  return {
    ...snapshotOf("IN_PROGRESS", stop(1, "Bodega Rosita")),
    ...deliveryCatalog(),
    orders: [
      {
        id: "o-1",
        stopId: "stop-1",
        items: [
          {
            product: { id: "p-refill", name: "Recarga 20L" },
            productType: "REFILL",
            quantity: 3,
            unitPrice: "12.50",
          },
        ],
      },
    ],
  } as RouteSnapshot;
}

async function openDelivery(store: OfflineStore, snapshot = deliverySnapshot()) {
  await renderList(fakeClient(snapshot, OFFLINE).client, store);
  const card = await screen.findByLabelText("Parada 1");
  await fireEvent.press(within(card).getByRole("button", { name: "Se entregó" }));
}

const saveDelivery = () =>
  fireEvent.press(screen.getByRole("button", { name: "Guardar la entrega" }));

describe("marcar una parada como entregada", () => {
  it("precarga lo pedido y sin señal queda «Entregada · Pendiente de enviar» con venta, vacíos y cobro", async () => {
    const store = memoryOfflineStore();
    await openDelivery(store);

    expect(screen.getByLabelText("Cantidad de Recarga 20L")).toHaveDisplayValue("3");
    expect(screen.getByText("Precio pactado: S/ 12.50 · Subtotal: S/ 37.50")).toBeOnTheScreen();
    expect(screen.getByText("Total de la venta: S/ 37.50")).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText("Vacíos devueltos de Bidón 20L"), "2");
    await fireEvent.press(screen.getByRole("radio", { name: "Efectivo" }));
    await fireEvent.changeText(screen.getByLabelText("Monto cobrado"), "20.00");
    await saveDelivery();

    expect(await screen.findByText("Entregada · Pendiente de enviar")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Se entregó" })).toBeNull();
    expect(store.operations).toHaveLength(1);
    // El precio no viaja: el servidor cobra el pactado, como en «Mi ruta».
    expect(store.operations[0]?.envelope.payload).toEqual({
      routeId: "r-1",
      stopId: "stop-1",
      status: "DELIVERED",
      items: [{ productId: "p-refill", quantity: 3 }],
      containersReturned: [{ containerTypeId: "ct-20l", quantity: 2 }],
      payment: { paymentMethodId: "pm-cash", amount: "20.00" },
    });
  });

  it("entrega distinto de lo pedido: otra cantidad y otro producto, al precio del local", async () => {
    const store = memoryOfflineStore();
    await openDelivery(store);

    await fireEvent.press(screen.getByRole("button", { name: "Agregar producto" }));
    await fireEvent.press(screen.getByRole("button", { name: "Bidón nuevo 20L" }));
    await fireEvent.changeText(screen.getByLabelText("Cantidad de Recarga 20L"), "5");

    expect(screen.getByText("Total de la venta: S/ 87.50")).toBeOnTheScreen();
    await saveDelivery();

    await screen.findByText("Entregada · Pendiente de enviar");
    expect(store.operations[0]?.envelope.payload).toMatchObject({
      items: [
        { productId: "p-refill", quantity: 5 },
        { productId: "p-jug", quantity: 1 },
      ],
    });
    // Al fiado: sin cobro en el sobre.
    expect(store.operations[0]?.envelope.payload).not.toHaveProperty("payment");
  });

  it("avisa que supera el límite de crédito y la guarda igual", async () => {
    const store = memoryOfflineStore();
    await openDelivery(store);
    const warning = "Esta venta supera el límite de crédito de Bodega Rosita. Se guarda igual.";

    // Debe 10.00: 3 recargas al fiado la dejan en 47.50, dentro de 50.00.
    expect(screen.queryByText(warning)).toBeNull();

    // 4 recargas la dejan en 60.00.
    await fireEvent.changeText(screen.getByLabelText("Cantidad de Recarga 20L"), "4");
    expect(screen.getByText(warning)).toBeOnTheScreen();

    await saveDelivery();
    expect(await screen.findByText("Entregada · Pendiente de enviar")).toBeOnTheScreen();
    expect(store.operations).toHaveLength(1);
  });

  it("sin productos avisa con las palabras de la web y no guarda nada", async () => {
    const store = memoryOfflineStore();
    await openDelivery(store);

    await fireEvent.press(screen.getByRole("button", { name: "Quitar Recarga 20L" }));
    await saveDelivery();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Una entrega tiene que decir qué se entregó",
    );
    expect(store.operations).toHaveLength(0);

    await fireEvent.press(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.getByRole("button", { name: "Se entregó" })).toBeOnTheScreen();
  });

  it("si el celular no la pudo guardar, lo dice y deja reintentar", async () => {
    const store = memoryOfflineStore();
    store.addOperation = () => Promise.reject(new Error("SQLITE_FULL"));
    await openDelivery(store);

    await saveDelivery();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo guardar en el celular. Inténtalo de nuevo.",
    );
    expect(screen.getByRole("button", { name: "Guardar la entrega" })).toBeOnTheScreen();
  });

  it("al guardarla, la deuda del cliente y los envases del local cambian en la parada", async () => {
    const store = memoryOfflineStore();
    await openDelivery(store);
    const card = screen.getByLabelText("Parada 1");

    expect(within(card).getByText("Deuda del cliente: S/ 10.00")).toBeOnTheScreen();
    expect(within(card).getByText("Envases en el local: 3 Bidón 20L")).toBeOnTheScreen();

    // 3 recargas a 12.50, 2 vacíos devueltos, 20.00 en efectivo.
    await fireEvent.changeText(screen.getByLabelText("Vacíos devueltos de Bidón 20L"), "2");
    await fireEvent.press(screen.getByRole("radio", { name: "Efectivo" }));
    await fireEvent.changeText(screen.getByLabelText("Monto cobrado"), "20.00");
    await saveDelivery();

    await screen.findByText("Entregada · Pendiente de enviar");
    expect(within(card).getByText("Deuda del cliente: S/ 27.50")).toBeOnTheScreen();
    expect(within(card).getByText("Envases en el local: 4 Bidón 20L")).toBeOnTheScreen();
  });

  it("enviada con señal, el saldo no vuelve atrás aunque la ruta se haya bajado antes", async () => {
    const store = memoryOfflineStore();
    const server = fakeClient(deliverySnapshot(), (body) => ({
      results: body.operations.map((op) => ({ id: op.id, status: "APPLIED", quarantined: false })),
    }));
    await renderList(server.client, store);
    const card = await screen.findByLabelText("Parada 1");
    await fireEvent.press(within(card).getByRole("button", { name: "Se entregó" }));

    await saveDelivery();

    expect(await screen.findByText("Entregada · Enviada")).toBeOnTheScreen();
    expect(within(card).getByText("Deuda del cliente: S/ 47.50")).toBeOnTheScreen();
    expect(within(card).getByText("Envases en el local: 6 Bidón 20L")).toBeOnTheScreen();
  });

  it("un local sin envases lo dice, y una deuda a favor se lee a favor", async () => {
    const snapshot = deliverySnapshot();
    snapshot.locations = snapshot.locations.map((location) => ({
      ...location,
      debtBalance: "-15.00",
      containerBalances: [],
    }));
    await renderList(fakeClient(snapshot, OFFLINE).client, memoryOfflineStore());

    const card = await screen.findByLabelText("Parada 1");
    expect(within(card).getByText("Deuda del cliente: A favor S/ 15.00")).toBeOnTheScreen();
    expect(within(card).getByText("Envases en el local: ninguno")).toBeOnTheScreen();
  });

  it("una parada sin el local en la ruta guardada no ofrece «Se entregó» ni saldos", async () => {
    await renderList(
      fakeClient(snapshotOf("IN_PROGRESS", stop(1, "Bodega Rosita")), OFFLINE).client,
      memoryOfflineStore(),
    );

    const card = await screen.findByLabelText("Parada 1");
    expect(within(card).queryByRole("button", { name: "Se entregó" })).toBeNull();
    expect(within(card).getByRole("button", { name: "No se pudo entregar" })).toBeOnTheScreen();
    expect(within(card).queryByText(/Deuda del cliente/)).toBeNull();
  });
});
