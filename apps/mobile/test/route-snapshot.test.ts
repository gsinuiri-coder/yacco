import type { RouteSnapshot } from "@yacco/shared";

import { loadRouteSnapshot } from "../src/offline/route-snapshot";
import { ApiError, OfflineError, type ApiClient } from "../src/session/api-client";
import { memoryOfflineStore } from "./fakes";

const DRIVER_ID = "u-1";
const TODAY = {
  generatedAt: "2026-10-23T12:00:00.000Z",
  route: { driverId: DRIVER_ID },
} as RouteSnapshot;
const YESTERDAY = {
  generatedAt: "2026-10-22T12:00:00.000Z",
  route: { driverId: DRIVER_ID },
} as RouteSnapshot;

const OFFLINE = new OfflineError(new TypeError("Network request failed"));

function clientReplying(reply: RouteSnapshot | Error) {
  const request = jest.fn(async () => {
    if (reply instanceof Error) throw reply;
    return reply;
  });
  return { request, client: { request } as unknown as ApiClient };
}

describe("la ruta guardada en el celular", () => {
  it("con señal baja la ruta y la guarda", async () => {
    const store = memoryOfflineStore();
    store.snapshot = YESTERDAY;
    const { request, client } = clientReplying(TODAY);

    const loaded = await loadRouteSnapshot(client, store, DRIVER_ID);

    expect(request).toHaveBeenCalledWith("/sync/route-snapshot");
    expect(loaded).toEqual({ snapshot: TODAY, fromDevice: false });
    expect(store.snapshot).toBe(TODAY);
  });

  it.each([
    ["sin señal", OFFLINE],
    ["con el servidor caído", new ApiError(503, "El servidor tuvo un problema.")],
  ])("%s abre la que quedó guardada", async (_case, error) => {
    const store = memoryOfflineStore();
    store.snapshot = YESTERDAY;

    const loaded = await loadRouteSnapshot(clientReplying(error).client, store, DRIVER_ID);

    expect(loaded).toEqual({ snapshot: YESTERDAY, fromDevice: true });
  });

  // La ruta guardada se borra al cerrar sesión, pero puede quedar la de otro
  // chofer si su sesión venció o se cortó: esa no se le muestra a nadie más.
  it("sin señal no abre la ruta guardada de otro chofer", async () => {
    const store = memoryOfflineStore();
    store.snapshot = { ...YESTERDAY, route: { driverId: "u-2" } } as RouteSnapshot;

    const loaded = await loadRouteSnapshot(clientReplying(OFFLINE).client, store, DRIVER_ID);

    expect(loaded).toEqual({ snapshot: null, fromDevice: true });
  });

  it("si el servidor dice que no tiene ruta, no muestra la vieja", async () => {
    const store = memoryOfflineStore();
    store.snapshot = YESTERDAY;
    const notFound = new ApiError(404, "No tienes una ruta para hoy");

    await expect(loadRouteSnapshot(clientReplying(notFound).client, store, DRIVER_ID)).rejects.toBe(
      notFound,
    );
  });
});
