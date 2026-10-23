import type { RouteSnapshot, RouteStop } from "@yacco/shared";
import { render, screen } from "@testing-library/react-native";

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
  return { route: { id: "r-1", stops } } as unknown as RouteSnapshot;
}

function clientReplying(reply: RouteSnapshot | Error): ApiClient {
  return {
    request: jest.fn(async () => {
      if (reply instanceof Error) throw reply;
      return reply;
    }),
  } as unknown as ApiClient;
}

describe("las paradas de la ruta en el celular", () => {
  it("con señal muestra las paradas del servidor, con su estado, sin el aviso de guardada", async () => {
    const store = memoryOfflineStore();
    store.snapshot = snapshotWith(stop(1, "Bodega de ayer"));
    const today = snapshotWith(
      stop(1, "Bodega Rosita"),
      stop(2, "Restaurante El Sol", { status: "DELIVERED", origin: "VAN_SALE" }),
    );

    await render(<RouteStopsList client={clientReplying(today)} store={store} />);

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
    const offline = new OfflineError(new TypeError("Network request failed"));

    await render(<RouteStopsList client={clientReplying(offline)} store={store} />);

    expect(await screen.findByText("1. Bodega Rosita")).toBeOnTheScreen();
    expect(screen.getByText("No entregada")).toBeOnTheScreen();
    expect(screen.getByText("Sin señal: es la ruta guardada en el celular.")).toBeOnTheScreen();
  });

  it("sin señal y sin nada guardado pide conectarse", async () => {
    const offline = new OfflineError(new TypeError("Network request failed"));

    await render(<RouteStopsList client={clientReplying(offline)} store={memoryOfflineStore()} />);

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

    await render(<RouteStopsList client={clientReplying(notFound)} store={store} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("No tienes una ruta para hoy");
    expect(screen.queryByText("1. Bodega de ayer")).toBeNull();
  });

  it("si falla la base del celular, avisa sin detalles técnicos", async () => {
    const store = memoryOfflineStore();
    store.saveSnapshot = () => Promise.reject(new Error("SQLITE_FULL"));

    await render(<RouteStopsList client={clientReplying(snapshotWith())} store={store} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo abrir la ruta. Inténtalo de nuevo.",
    );
  });

  it("una ruta sin paradas lo dice", async () => {
    await render(
      <RouteStopsList client={clientReplying(snapshotWith())} store={memoryOfflineStore()} />,
    );

    expect(await screen.findByText("Tu ruta no tiene paradas.")).toBeOnTheScreen();
  });
});
