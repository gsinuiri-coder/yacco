import type { RouteSnapshot } from "@yacco/shared";

import { loadRouteSnapshot } from "../src/offline/route-snapshot";
import { ApiError, OfflineError, type ApiClient } from "../src/session/api-client";
import { memoryOfflineStore } from "./fakes";

const TODAY = { generatedAt: "2026-10-23T12:00:00.000Z" } as RouteSnapshot;
const YESTERDAY = { generatedAt: "2026-10-22T12:00:00.000Z" } as RouteSnapshot;

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

    const loaded = await loadRouteSnapshot(client, store);

    expect(request).toHaveBeenCalledWith("/sync/route-snapshot");
    expect(loaded).toEqual({ snapshot: TODAY, fromDevice: false });
    expect(store.snapshot).toBe(TODAY);
  });

  it.each([
    ["sin señal", new OfflineError(new TypeError("Network request failed"))],
    ["con el servidor caído", new ApiError(503, "El servidor tuvo un problema.")],
  ])("%s abre la que quedó guardada", async (_case, error) => {
    const store = memoryOfflineStore();
    store.snapshot = YESTERDAY;

    const loaded = await loadRouteSnapshot(clientReplying(error).client, store);

    expect(loaded).toEqual({ snapshot: YESTERDAY, fromDevice: true });
  });

  it("si el servidor dice que no tiene ruta, no muestra la vieja", async () => {
    const store = memoryOfflineStore();
    store.snapshot = YESTERDAY;
    const notFound = new ApiError(404, "No tienes una ruta para hoy");

    await expect(loadRouteSnapshot(clientReplying(notFound).client, store)).rejects.toBe(notFound);
  });
});
