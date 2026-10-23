import type { RouteSnapshot, SyncOperationEnvelope } from "@yacco/shared";
import type { SQLiteDatabase } from "expo-sqlite";

import type { OfflineStore, QueuedOperation, QueuedOperationState } from "./offline-store";

export const OFFLINE_DATABASE_NAME = "yacco-driver.db";

/** Una sola ruta guardada a la vez: la del día. */
const SNAPSHOT_KEY = "current";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS route_snapshots (
  key TEXT PRIMARY KEY NOT NULL,
  body TEXT NOT NULL,
  saved_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS queued_operations (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL,
  version INTEGER NOT NULL,
  client_timestamp TEXT NOT NULL,
  payload TEXT NOT NULL,
  state TEXT NOT NULL,
  reason TEXT,
  driver_id TEXT NOT NULL
);
`;

interface QueuedOperationRow {
  id: string;
  type: SyncOperationEnvelope["type"];
  version: number;
  client_timestamp: string;
  payload: string;
  state: QueuedOperationState;
  reason: string | null;
}

/** Crea las tablas si es la primera vez que abre la app. */
export async function createSqliteOfflineStore(db: SQLiteDatabase): Promise<OfflineStore> {
  await db.execAsync(SCHEMA);

  return {
    async saveSnapshot(snapshot: RouteSnapshot) {
      await db.runAsync(
        "INSERT OR REPLACE INTO route_snapshots (key, body, saved_at) VALUES (?, ?, ?)",
        SNAPSHOT_KEY,
        JSON.stringify(snapshot),
        new Date().toISOString(),
      );
    },
    async loadSnapshot() {
      const row = await db.getFirstAsync<{ body: string }>(
        "SELECT body FROM route_snapshots WHERE key = ?",
        SNAPSHOT_KEY,
      );
      return row ? (JSON.parse(row.body) as RouteSnapshot) : null;
    },
    async clearSnapshot() {
      await db.runAsync("DELETE FROM route_snapshots");
    },
    async addOperation(envelope, driverId) {
      await db.runAsync(
        "INSERT INTO queued_operations (id, type, version, client_timestamp, payload, state, driver_id) VALUES (?, ?, ?, ?, ?, 'PENDING', ?)",
        envelope.id,
        envelope.type,
        envelope.version,
        envelope.clientTimestamp,
        JSON.stringify(envelope.payload),
        driverId,
      );
    },
    async listOperations(driverId): Promise<QueuedOperation[]> {
      const rows = await db.getAllAsync<QueuedOperationRow>(
        "SELECT id, type, version, client_timestamp, payload, state, reason FROM queued_operations WHERE driver_id = ? ORDER BY client_timestamp, rowid",
        driverId,
      );
      return rows.map((row) => ({
        envelope: {
          id: row.id,
          type: row.type,
          version: row.version,
          clientTimestamp: row.client_timestamp,
          payload: JSON.parse(row.payload) as Record<string, unknown>,
        },
        state: row.state,
        reason: row.reason,
      }));
    },
    async setOperationState(id, state, reason) {
      await db.runAsync(
        "UPDATE queued_operations SET state = ?, reason = ? WHERE id = ?",
        state,
        reason,
        id,
      );
    },
  };
}
