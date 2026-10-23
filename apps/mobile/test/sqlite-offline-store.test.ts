import type { SQLiteDatabase } from "expo-sqlite";

import { createSqliteOfflineStore } from "../src/offline/sqlite-offline-store";

function fakeDatabase(rows: { first?: unknown; all?: unknown[] } = {}) {
  const db = {
    execAsync: jest.fn(async () => undefined),
    runAsync: jest.fn(async () => ({ lastInsertRowId: 1, changes: 1 })),
    getFirstAsync: jest.fn(async () => rows.first ?? null),
    getAllAsync: jest.fn(async () => rows.all ?? []),
  };
  return { db, database: db as unknown as SQLiteDatabase };
}

const ENVELOPE = {
  id: "6f1c1f0e-0000-4000-8000-000000000001",
  type: "STOP_MARK" as const,
  version: 1,
  clientTimestamp: "2026-10-23T14:05:00.000Z",
  payload: { routeId: "r-1", stopId: "s-1", status: "DELIVERED" },
};

describe("la base SQLite del celular", () => {
  it("crea sus tablas al abrir", async () => {
    const { db, database } = fakeDatabase();

    await createSqliteOfflineStore(database);

    const schema = db.execAsync.mock.calls[0] as unknown as [string];
    expect(schema[0]).toContain("CREATE TABLE IF NOT EXISTS route_snapshots");
    expect(schema[0]).toContain("CREATE TABLE IF NOT EXISTS queued_operations");
  });

  it("guarda la ruta como texto y la devuelve igual", async () => {
    const snapshot = { generatedAt: "2026-10-23T12:00:00.000Z" };
    const { db, database } = fakeDatabase({ first: { body: JSON.stringify(snapshot) } });
    const store = await createSqliteOfflineStore(database);

    await store.saveSnapshot(snapshot as never);

    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining("INSERT OR REPLACE INTO route_snapshots"),
      "current",
      JSON.stringify(snapshot),
      expect.any(String),
    );
    expect(await store.loadSnapshot()).toEqual(snapshot);
  });

  it("sin ruta guardada devuelve null", async () => {
    const store = await createSqliteOfflineStore(fakeDatabase().database);

    expect(await store.loadSnapshot()).toBeNull();
  });

  it("encola pendiente y lee la cola con sus estados", async () => {
    const { db, database } = fakeDatabase({
      all: [
        {
          id: ENVELOPE.id,
          type: "STOP_MARK",
          version: 1,
          client_timestamp: ENVELOPE.clientTimestamp,
          payload: JSON.stringify(ENVELOPE.payload),
          state: "IN_REVIEW",
          reason: "La parada ya fue entregada",
        },
      ],
    });
    const store = await createSqliteOfflineStore(database);

    await store.addOperation(ENVELOPE);
    await store.setOperationState(ENVELOPE.id, "IN_REVIEW", "La parada ya fue entregada");

    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining("'PENDING'"),
      ENVELOPE.id,
      "STOP_MARK",
      1,
      ENVELOPE.clientTimestamp,
      JSON.stringify(ENVELOPE.payload),
    );
    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE queued_operations"),
      "IN_REVIEW",
      "La parada ya fue entregada",
      ENVELOPE.id,
    );
    expect(await store.listOperations()).toEqual([
      { envelope: ENVELOPE, state: "IN_REVIEW", reason: "La parada ya fue entregada" },
    ]);
  });
});
