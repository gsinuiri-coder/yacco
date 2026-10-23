import type {
  RouteLocationPointPayloadV1,
  RouteSnapshot,
  RouteStatus,
  SyncOperationEnvelope,
} from "@yacco/shared";

import type { QueuedOperationState } from "../src/offline/offline-store";
import { markedPositionOf, recordRouteLocations } from "../src/location/route-tracking";
import { memoryOfflineStore } from "./fakes";

// Fase 3, fila 11c: lo que hace la tarea de fondo con cada tanda de lecturas.

function savedRoute(status: RouteStatus, driverId = "u-1"): RouteSnapshot {
  return {
    route: { id: "r-1", driverId, status, stops: [] },
    locationIntervalSeconds: 300,
  } as unknown as RouteSnapshot;
}

function reading(latitude: number, longitude: number, at: string, accuracy: number | null = 9.5) {
  return { coords: { latitude, longitude, accuracy }, timestamp: Date.parse(at) };
}

function queued(
  id: string,
  type: SyncOperationEnvelope["type"],
  clientTimestamp: string,
): SyncOperationEnvelope {
  return { id, type, version: 1, clientTimestamp, payload: { routeId: "r-1" } };
}

async function queue(
  store: ReturnType<typeof memoryOfflineStore>,
  envelope: SyncOperationEnvelope,
  state: QueuedOperationState,
) {
  await store.addOperation(envelope, "u-1");
  await store.setOperationState(envelope.id, state, null);
}

function counter() {
  let next = 0;
  return () => `id-${++next}`;
}

describe("la tarea de la ubicación en segundo plano", () => {
  it("con la ruta en curso deja cada lectura en la cola del chofer: el punto con la hora del GPS, el sobre con la del celular", async () => {
    const store = memoryOfflineStore();
    store.snapshot = savedRoute("IN_PROGRESS");
    const phoneClock = () => new Date("2026-10-23T14:06:00.000Z");

    const outcome = await recordRouteLocations(
      store,
      [
        reading(-12.0463741, -77.0427934, "2026-10-23T14:00:00.000Z"),
        reading(-12.05, -77.04, "2026-10-23T14:05:00.000Z", 12),
      ],
      counter(),
      phoneClock,
    );

    expect(outcome).toBe("recorded");
    expect(
      store.operations.map(({ envelope, state, driverId }) => ({ envelope, state, driverId })),
    ).toEqual([
      {
        state: "PENDING",
        driverId: "u-1",
        envelope: {
          id: "id-2",
          type: "ROUTE_LOCATION_POINT",
          version: 1,
          clientTimestamp: "2026-10-23T14:06:00.000Z",
          payload: {
            routeId: "r-1",
            clientPointId: "id-1",
            latitude: "-12.046374",
            longitude: "-77.042793",
            accuracyM: "9.50",
            recordedAt: "2026-10-23T14:00:00.000Z",
          },
        },
      },
      {
        state: "PENDING",
        driverId: "u-1",
        envelope: {
          id: "id-4",
          type: "ROUTE_LOCATION_POINT",
          version: 1,
          clientTimestamp: "2026-10-23T14:06:00.000Z",
          payload: {
            routeId: "r-1",
            clientPointId: "id-3",
            latitude: "-12.050000",
            longitude: "-77.040000",
            accuracyM: "12.00",
            recordedAt: "2026-10-23T14:05:00.000Z",
          },
        },
      },
    ]);
  });

  it("descarta una lectura que la API no aceptaría y guarda las demás", async () => {
    const store = memoryOfflineStore();
    store.snapshot = savedRoute("IN_PROGRESS");

    await recordRouteLocations(
      store,
      [
        reading(-12.04, -77.04, "2026-10-23T14:00:00.000Z", null),
        reading(-12.05, -77.04, "2026-10-23T14:05:00.000Z"),
      ],
      counter(),
    );

    expect(
      store.operations.map(
        (op) => (op.envelope.payload as unknown as RouteLocationPointPayloadV1).recordedAt,
      ),
    ).toEqual(["2026-10-23T14:05:00.000Z"]);
  });

  it("con la ruta empezada en el celular sin señal ya la sigue", async () => {
    const store = memoryOfflineStore();
    store.snapshot = savedRoute("PLANNED");
    await queue(store, queued("start", "ROUTE_START", "2026-10-23T13:00:00.000Z"), "PENDING");

    const outcome = await recordRouteLocations(
      store,
      [reading(-12.05, -77.04, "2026-10-23T14:05:00.000Z")],
      counter(),
      () => new Date("2026-10-23T14:05:00.000Z"),
    );

    expect(outcome).toBe("recorded");
    expect(store.operations.map((op) => op.envelope.type)).toEqual([
      "ROUTE_START",
      "ROUTE_LOCATION_POINT",
    ]);
  });

  it("con el reloj del celular adelantado al GPS, el punto igual sale después de «Empezar la ruta»", async () => {
    const store = memoryOfflineStore();
    store.snapshot = savedRoute("PLANNED");
    // El celular marca 14:10 al empezar; el GPS, que tiene la hora real, 14:02.
    await queue(store, queued("start", "ROUTE_START", "2026-10-23T14:10:00.000Z"), "PENDING");

    await recordRouteLocations(
      store,
      [reading(-12.05, -77.04, "2026-10-23T14:02:00.000Z")],
      counter(),
      () => new Date("2026-10-23T14:15:00.000Z"),
    );

    const sent = (await store.listOperations("u-1")).sort((a, b) =>
      a.envelope.clientTimestamp.localeCompare(b.envelope.clientTimestamp),
    );
    expect(sent.map((op) => op.envelope.type)).toEqual(["ROUTE_START", "ROUTE_LOCATION_POINT"]);
  });

  it.each<[string, (store: ReturnType<typeof memoryOfflineStore>) => Promise<void>]>([
    ["sin ruta guardada (cerró sesión)", async () => undefined],
    [
      "con la ruta terminada",
      async (store) => {
        store.snapshot = savedRoute("FINISHED");
      },
    ],
    [
      "con la ruta planificada y sin empezar",
      async (store) => {
        store.snapshot = savedRoute("PLANNED");
      },
    ],
  ])("%s no guarda nada y pide apagarse", async (_case, arrange) => {
    const store = memoryOfflineStore();
    await arrange(store);

    const outcome = await recordRouteLocations(
      store,
      [reading(-12.05, -77.04, "2026-10-23T14:05:00.000Z")],
      counter(),
    );

    expect(outcome).toBe("stop");
    expect(store.operations).toEqual([]);
  });

  it("se apaga cuando el servidor rechazó su último punto, aunque antes haya rechazado otro y aceptado el siguiente", async () => {
    const accepted = memoryOfflineStore();
    accepted.snapshot = savedRoute("IN_PROGRESS");
    await queue(
      accepted,
      queued("p-1", "ROUTE_LOCATION_POINT", "2026-10-23T13:00:00.000Z"),
      "IN_REVIEW",
    );
    await queue(
      accepted,
      queued("p-2", "ROUTE_LOCATION_POINT", "2026-10-23T13:05:00.000Z"),
      "SENT",
    );
    const rejected = memoryOfflineStore();
    rejected.snapshot = savedRoute("IN_PROGRESS");
    await queue(
      rejected,
      queued("p-1", "ROUTE_LOCATION_POINT", "2026-10-23T13:00:00.000Z"),
      "SENT",
    );
    await queue(
      rejected,
      queued("p-2", "ROUTE_LOCATION_POINT", "2026-10-23T13:05:00.000Z"),
      "IN_REVIEW",
    );
    const readings = [reading(-12.05, -77.04, "2026-10-23T14:05:00.000Z")];

    expect(await recordRouteLocations(accepted, readings, counter())).toBe("recorded");
    expect(await recordRouteLocations(rejected, readings, counter())).toBe("stop");
    expect(rejected.operations).toHaveLength(2);
  });
});

describe("la posición al marcar la parada", () => {
  it("va como la toma la API", () => {
    expect(
      markedPositionOf({ latitude: -12.0463741, longitude: -77.0427934, accuracy: 8 }),
    ).toEqual({
      markedLatitude: "-12.046374",
      markedLongitude: "-77.042793",
      markedAccuracyM: "8.00",
    });
  });

  it("sin una lectura válida la marca sale sin posición", () => {
    expect(markedPositionOf({ latitude: 95, longitude: -77, accuracy: 8 })).toEqual({});
  });
});
