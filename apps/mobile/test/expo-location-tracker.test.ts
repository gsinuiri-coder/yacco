import type { RouteSnapshot } from "@yacco/shared";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

import {
  MARK_POSITION_TIMEOUT_MS,
  createExpoLocationTracker,
  defineRouteLocationTask,
} from "../src/location/expo-location-tracker";
import { LOCATION_TASK_NAME } from "../src/location/route-tracking";
import { memoryOfflineStore } from "./fakes";

jest.mock("expo-location", () => ({
  PermissionStatus: { GRANTED: "granted", DENIED: "denied" },
  Accuracy: { Balanced: 3, High: 4 },
  hasStartedLocationUpdatesAsync: jest.fn(),
  startLocationUpdatesAsync: jest.fn(async () => undefined),
  stopLocationUpdatesAsync: jest.fn(async () => undefined),
  requestForegroundPermissionsAsync: jest.fn(),
  requestBackgroundPermissionsAsync: jest.fn(),
  getForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));

jest.mock("expo-task-manager", () => ({ defineTask: jest.fn() }));

const location = jest.mocked(Location);
const granted = { status: "granted" } as Location.LocationPermissionResponse;
const denied = { status: "denied" } as Location.LocationPermissionResponse;

beforeEach(() => {
  jest.clearAllMocks();
  location.hasStartedLocationUpdatesAsync.mockResolvedValue(false);
  location.requestForegroundPermissionsAsync.mockResolvedValue(granted);
  location.requestBackgroundPermissionsAsync.mockResolvedValue(granted);
  location.getForegroundPermissionsAsync.mockResolvedValue(granted);
});

describe("seguir la ruta en segundo plano", () => {
  it("con la ruta en curso y permiso, prende la ubicación con la notificación fija", async () => {
    await createExpoLocationTracker().follow(true, 300);

    expect(location.startLocationUpdatesAsync).toHaveBeenCalledWith(
      LOCATION_TASK_NAME,
      expect.objectContaining({
        timeInterval: 300_000,
        foregroundService: expect.objectContaining({
          notificationTitle: "Ruta en curso",
          notificationBody:
            "Yacco guarda tu ubicación cada 5 minutos mientras tu ruta está en curso.",
        }),
      }),
    );
  });

  it("con un intervalo de un minuto lo dice en singular", async () => {
    await createExpoLocationTracker().follow(true, 60);

    expect(location.startLocationUpdatesAsync).toHaveBeenCalledWith(
      LOCATION_TASK_NAME,
      expect.objectContaining({
        foregroundService: expect.objectContaining({
          notificationBody: "Yacco guarda tu ubicación cada minuto mientras tu ruta está en curso.",
        }),
      }),
    );
  });

  it("ya prendida no la vuelve a prender", async () => {
    location.hasStartedLocationUpdatesAsync.mockResolvedValue(true);

    await createExpoLocationTracker().follow(true, 300);

    expect(location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(location.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it.each([
    ["en primer plano", () => location.requestForegroundPermissionsAsync.mockResolvedValue(denied)],
    [
      "en segundo plano",
      () => location.requestBackgroundPermissionsAsync.mockResolvedValue(denied),
    ],
  ])("sin permiso %s no la prende, y la ruta se trabaja igual", async (_case, deny) => {
    deny();

    await expect(createExpoLocationTracker().follow(true, 300)).resolves.toBeUndefined();

    expect(location.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it("si el celular falla al prenderla, no rompe la pantalla", async () => {
    location.startLocationUpdatesAsync.mockRejectedValueOnce(new Error("GPS apagado"));

    await expect(createExpoLocationTracker().follow(true, 300)).resolves.toBeUndefined();
  });

  it("con la ruta que ya no está en curso, la apaga si estaba prendida", async () => {
    location.hasStartedLocationUpdatesAsync.mockResolvedValue(true);

    await createExpoLocationTracker().follow(false, 300);

    expect(location.stopLocationUpdatesAsync).toHaveBeenCalledWith(LOCATION_TASK_NAME);
  });

  it("apagada no hay nada que apagar", async () => {
    await createExpoLocationTracker().stop();

    expect(location.stopLocationUpdatesAsync).not.toHaveBeenCalled();
  });
});

describe("la posición al marcar la parada", () => {
  it("con permiso, la de ese momento", async () => {
    location.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: -12.0463741, longitude: -77.0427934, accuracy: 6 },
      timestamp: 0,
    } as Location.LocationObject);

    expect(await createExpoLocationTracker().markedPosition()).toEqual({
      markedLatitude: "-12.046374",
      markedLongitude: "-77.042793",
      markedAccuracyM: "6.00",
    });
  });

  it("sin permiso marca sin posición y no lo vuelve a pedir", async () => {
    location.getForegroundPermissionsAsync.mockResolvedValue(denied);

    expect(await createExpoLocationTracker().markedPosition()).toEqual({});
    expect(location.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it("si el GPS falla, marca sin posición", async () => {
    location.getCurrentPositionAsync.mockRejectedValue(new Error("sin GPS"));

    expect(await createExpoLocationTracker().markedPosition()).toEqual({});
  });

  it("si el GPS tarda, no frena la marca", async () => {
    jest.useFakeTimers();
    try {
      location.getCurrentPositionAsync.mockReturnValue(new Promise(() => undefined));

      const pending = createExpoLocationTracker().markedPosition();
      await jest.advanceTimersByTimeAsync(MARK_POSITION_TIMEOUT_MS);

      expect(await pending).toEqual({});
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("la tarea que Android despierta", () => {
  type Executor = Parameters<typeof TaskManager.defineTask<{ locations: unknown[] }>>[1];

  function definedTask(store: ReturnType<typeof memoryOfflineStore>): Executor {
    let next = 0;
    defineRouteLocationTask(store, () => `id-${++next}`);
    const call = jest.mocked(TaskManager.defineTask).mock.calls.at(-1);
    expect(call?.[0]).toBe(LOCATION_TASK_NAME);
    return call?.[1] as Executor;
  }

  const readings = {
    locations: [
      {
        coords: { latitude: -12.05, longitude: -77.04, accuracy: 9 },
        timestamp: Date.parse("2026-10-23T14:05:00.000Z"),
      },
    ],
  };

  it("deja los puntos en la cola y avisa a la pantalla", async () => {
    const store = memoryOfflineStore();
    store.snapshot = {
      route: { id: "r-1", driverId: "u-1", status: "IN_PROGRESS", stops: [] },
    } as unknown as RouteSnapshot;
    const task = definedTask(store);
    const tracker = createExpoLocationTracker();
    const listener = jest.fn();
    const unsubscribe = tracker.onRecorded(listener);

    await task({ data: readings, error: null, executionInfo: {} as never });
    unsubscribe();
    await task({ data: readings, error: null, executionInfo: {} as never });

    expect(store.operations.map((op) => op.envelope.type)).toEqual([
      "ROUTE_LOCATION_POINT",
      "ROUTE_LOCATION_POINT",
    ]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("sin ruta guardada se apaga sola", async () => {
    location.hasStartedLocationUpdatesAsync.mockResolvedValue(true);
    const store = memoryOfflineStore();

    await definedTask(store)({ data: readings, error: null, executionInfo: {} as never });

    expect(location.stopLocationUpdatesAsync).toHaveBeenCalledWith(LOCATION_TASK_NAME);
    expect(store.operations).toEqual([]);
  });

  it("con un error del sistema no guarda nada", async () => {
    const store = memoryOfflineStore();
    store.snapshot = {
      route: { id: "r-1", driverId: "u-1", status: "IN_PROGRESS", stops: [] },
    } as unknown as RouteSnapshot;

    await definedTask(store)({
      data: readings,
      error: { code: "E", message: "sin servicio" } as never,
      executionInfo: {} as never,
    });

    expect(store.operations).toEqual([]);
  });
});
