import type { RouteSnapshot, SyncOperationEnvelope } from "@yacco/shared";

import { lazyOfflineStore } from "../src/offline/lazy-offline-store";
import { memoryOfflineStore } from "./fakes";

const SNAPSHOT = { route: { id: "r-1", stops: [] } } as unknown as RouteSnapshot;
const ENVELOPE: SyncOperationEnvelope = {
  id: "11111111-1111-4111-8111-111111111111",
  type: "STOP_MARK",
  version: 1,
  clientTimestamp: "2026-10-23T14:00:00.000Z",
  payload: {},
};

describe("la base del celular, abierta al primer uso", () => {
  it("no la abre hasta que se usa, y la abre una sola vez aunque se use mucho", async () => {
    const inner = memoryOfflineStore();
    const open = jest.fn(async () => inner);
    const store = lazyOfflineStore(open);
    expect(open).not.toHaveBeenCalled();

    await Promise.all([store.saveSnapshot(SNAPSHOT), store.addOperation(ENVELOPE, "u-1")]);
    await store.setOperationState(ENVELOPE.id, "SENT", null);

    expect(open).toHaveBeenCalledTimes(1);
    expect(await store.loadSnapshot()).toBe(SNAPSHOT);
    expect(await store.listOperations("u-1")).toEqual([
      { envelope: ENVELOPE, state: "SENT", reason: null },
    ]);
    await store.clearSnapshot();
    expect(await store.loadSnapshot()).toBeNull();
  });

  it("si no se pudo abrir, el próximo uso lo intenta de nuevo", async () => {
    const inner = memoryOfflineStore();
    inner.snapshot = SNAPSHOT;
    const open = jest
      .fn<Promise<typeof inner>, []>()
      .mockRejectedValueOnce(new Error("SQLITE_CANTOPEN"))
      .mockResolvedValue(inner);
    const store = lazyOfflineStore(open);

    await expect(store.loadSnapshot()).rejects.toThrow("SQLITE_CANTOPEN");
    expect(await store.loadSnapshot()).toBe(SNAPSHOT);
    expect(open).toHaveBeenCalledTimes(2);
  });
});
