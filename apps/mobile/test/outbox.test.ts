import type { SyncBatchBody, SyncBatchResult, SyncOperationResult } from "@yacco/shared";

import { createOutbox, MAX_OPERATIONS_PER_BATCH } from "../src/offline/outbox";
import { OfflineError, type ApiClient } from "../src/session/api-client";
import { memoryOfflineStore } from "./fakes";

/** Un cliente que responde lo que el test decide y anota cada lote que salió. */
function fakeClient(reply: (body: SyncBatchBody) => SyncBatchResult | Error) {
  const batches: SyncBatchBody[] = [];
  const request = jest.fn(async (_path: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as SyncBatchBody;
    batches.push(body);
    const result = reply(body);
    if (result instanceof Error) throw result;
    return result;
  });
  return { batches, request, client: { request } as unknown as ApiClient };
}

const applied = (body: SyncBatchBody): SyncBatchResult => ({
  results: body.operations.map((op) => ({ id: op.id, status: "APPLIED", quarantined: false })),
});

function counter() {
  let n = 0;
  return () => `op-${++n}`;
}

const MARK = { routeId: "r-1", stopId: "s-1", status: "DELIVERED" };

describe("la cola de operaciones del chofer", () => {
  it("guarda cada acción pendiente, con el UUID y la hora del celular", async () => {
    const store = memoryOfflineStore();
    const outbox = createOutbox({
      store,
      driverId: "u-1",
      newId: () => "6f1c1f0e-0000-4000-8000-000000000001",
      now: () => new Date("2026-10-23T14:05:00.000Z"),
    });

    const envelope = await outbox.enqueue("STOP_MARK", 1, MARK);

    expect(envelope).toEqual({
      id: "6f1c1f0e-0000-4000-8000-000000000001",
      type: "STOP_MARK",
      version: 1,
      clientTimestamp: "2026-10-23T14:05:00.000Z",
      payload: MARK,
    });
    expect(await outbox.list()).toEqual([{ envelope, state: "PENDING", reason: null }]);
  });

  it("manda lo pendiente en el orden en que se hizo, no en el que entró a la cola", async () => {
    const store = memoryOfflineStore();
    const times = ["2026-10-23T15:00:00.000Z", "2026-10-23T14:00:00.000Z"];
    const outbox = createOutbox({
      store,
      driverId: "u-1",
      newId: counter(),
      now: () => new Date(times.shift()!),
    });
    await outbox.enqueue("STOP_MARK", 1, MARK);
    await outbox.enqueue("STOP_MARK", 1, MARK);
    const { batches, client } = fakeClient(applied);

    await outbox.flush(client);

    expect(batches[0]?.operations.map((op) => op.id)).toEqual(["op-2", "op-1"]);
  });

  it("deja cada operación en lo que respondió el servidor", async () => {
    const store = memoryOfflineStore();
    const outbox = createOutbox({ store, driverId: "u-1", newId: counter() });
    for (let i = 0; i < 4; i++) await outbox.enqueue("STOP_MARK", 1, MARK);
    const replies: Record<string, Omit<SyncOperationResult, "id">> = {
      "op-1": { status: "APPLIED", quarantined: false },
      "op-2": { status: "DUPLICATE", quarantined: false },
      "op-3": { status: "REJECTED", quarantined: true, reason: "La parada ya fue entregada" },
      "op-4": { status: "REJECTED", quarantined: false, reason: "Falta el método de pago" },
    };
    const { client } = fakeClient((body) => ({
      results: body.operations.map(
        (op) => ({ id: op.id, ...replies[op.id] }) as SyncOperationResult,
      ),
    }));

    const summary = await outbox.flush(client);

    expect((await outbox.list()).map(({ state, reason }) => ({ state, reason }))).toEqual([
      { state: "SENT", reason: null },
      { state: "SENT", reason: null },
      { state: "IN_REVIEW", reason: "La parada ya fue entregada" },
      // Sin cuarentena el servidor le da otro intento: sigue en la cola.
      { state: "PENDING", reason: "Falta el método de pago" },
    ]);
    expect(summary).toEqual({ sent: 2, inReview: 1, stillPending: 1 });
  });

  it("no vuelve a mandar lo que ya llegó", async () => {
    const store = memoryOfflineStore();
    const outbox = createOutbox({ store, driverId: "u-1", newId: counter() });
    await outbox.enqueue("STOP_MARK", 1, MARK);
    await outbox.flush(fakeClient(applied).client);
    await outbox.enqueue("STOP_MARK", 1, MARK);
    const { batches, client } = fakeClient(applied);

    await outbox.flush(client);

    expect(batches[0]?.operations.map((op) => op.id)).toEqual(["op-2"]);
  });

  it("sin señal no pierde nada: todo sigue pendiente", async () => {
    const store = memoryOfflineStore();
    const outbox = createOutbox({ store, driverId: "u-1", newId: counter() });
    await outbox.enqueue("STOP_MARK", 1, MARK);
    const { client } = fakeClient(() => new OfflineError(new TypeError("Network request failed")));

    await expect(outbox.flush(client)).rejects.toBeInstanceOf(OfflineError);

    expect((await outbox.list())[0]?.state).toBe("PENDING");
  });

  it("parte la cola en lotes del tope del servidor", async () => {
    const store = memoryOfflineStore();
    const outbox = createOutbox({ store, driverId: "u-1", newId: counter() });
    for (let i = 0; i < MAX_OPERATIONS_PER_BATCH + 1; i++) {
      await outbox.enqueue("STOP_MARK", 1, MARK);
    }
    const { batches, client } = fakeClient(applied);

    const summary = await outbox.flush(client);

    expect(batches.map((batch) => batch.operations.length)).toEqual([MAX_OPERATIONS_PER_BATCH, 1]);
    expect(summary).toEqual({ sent: MAX_OPERATIONS_PER_BATCH + 1, inReview: 0, stillPending: 0 });
  });

  it("dos envíos a la vez salen como uno solo", async () => {
    const store = memoryOfflineStore();
    const outbox = createOutbox({ store, driverId: "u-1", newId: counter() });
    await outbox.enqueue("STOP_MARK", 1, MARK);
    const { request, client } = fakeClient(applied);

    await Promise.all([outbox.flush(client), outbox.flush(client)]);

    expect(request).toHaveBeenCalledTimes(1);
  });

  it("con la cola vacía no llama al servidor", async () => {
    const { request, client } = fakeClient(applied);

    const summary = await createOutbox({
      store: memoryOfflineStore(),
      driverId: "u-1",
      newId: counter(),
    }).flush(client);

    expect(request).not.toHaveBeenCalled();
    expect(summary).toEqual({ sent: 0, inReview: 0, stillPending: 0 });
  });

  // Decisión de Giancarlo (2026-10-23 08:17): la cola queda a nombre de quien
  // la hizo; otro chofer en el mismo celular no la ve ni la envía.
  it("otro chofer en el mismo celular no ve ni manda la cola ajena, que sigue esperando a su dueño", async () => {
    const store = memoryOfflineStore();
    const juan = createOutbox({ store, driverId: "u-1", newId: () => "op-de-juan" });
    const pedro = createOutbox({ store, driverId: "u-2", newId: () => "op-de-pedro" });
    await juan.enqueue("STOP_MARK", 1, MARK);
    await pedro.enqueue("STOP_MARK", 1, MARK);
    const { batches, client } = fakeClient(applied);

    await pedro.flush(client);

    expect((await pedro.list()).map((op) => op.envelope.id)).toEqual(["op-de-pedro"]);
    expect(batches[0]?.operations.map((op) => op.id)).toEqual(["op-de-pedro"]);
    expect(await juan.list()).toMatchObject([{ envelope: { id: "op-de-juan" }, state: "PENDING" }]);
  });
});
