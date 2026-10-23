import type {
  RouteSnapshot,
  RouteStatus,
  RouteStop,
  SyncBatchBody,
  SyncBatchResult,
} from "@yacco/shared";
import { fireEvent, render, screen, within } from "@testing-library/react-native";

import type { OfflineStore } from "../src/offline/offline-store";
import { createOutbox } from "../src/offline/outbox";
import { RouteStopsList } from "../src/screens/RouteStopsList";
import { ApiError, OfflineError, type ApiClient } from "../src/session/api-client";
import { memoryOfflineStore } from "./fakes";

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
  return { route: { id: "r-1", status, stops } } as unknown as RouteSnapshot;
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
  const outbox = createOutbox({ store, newId: () => `op-${++next}` });
  await render(<RouteStopsList client={client} store={store} outbox={outbox} />);
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
    await store.addOperation({
      id: "op-de-ayer",
      type: "STOP_MARK",
      version: 1,
      clientTimestamp: "2026-10-23T14:00:00.000Z",
      payload: { routeId: "r-1", stopId: "stop-1", status: "FAILED", failureReason: "Cerrado" },
    });
    const server = fakeClient(route, (body) => ({
      results: body.operations.map((op) => ({ id: op.id, status: "APPLIED", quarantined: false })),
    }));

    await renderList(server.client, store);

    expect(await screen.findByText("No entregada · Enviada")).toBeOnTheScreen();
    expect(server.batches[0]?.operations.map((op) => op.id)).toEqual(["op-de-ayer"]);
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
