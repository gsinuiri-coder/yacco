import { GeoPoint, Timestamp } from "firebase-admin/firestore";

/**
 * Turns a Firestore document value into something JSON.stringify can write
 * WITHOUT losing information, and nothing more. This is the whole of what
 * the export does to the data: no cleaning, no renaming, no validation —
 * that is the loader's job, working from the file this produces. The file
 * is the frozen snapshot; anything decided here could not be undone later
 * without exporting again.
 *
 * Explicit conversions (everything else is passed through as-is):
 *   - Timestamp            -> ISO-8601 string (UTC, e.g. "2025-03-01T14:05:00.000Z")
 *   - Date                 -> ISO-8601 string (same reason; Firestore never
 *                             returns one, but a value already converted should
 *                             not break a second pass)
 *   - GeoPoint             -> { latitude, longitude }
 *   - Bytes (Buffer/Uint8Array) -> base64 string
 *   - DocumentReference    -> { _referencePath: "collection/id" } — the path is
 *                             the only thing that identifies it; the loader
 *                             decides what to do with it
 *   - number               -> as-is. Firestore integers and doubles are both
 *                             JS numbers already; money in the old system is
 *                             whatever it is there, and the loader parses it
 *                             into a 2-decimal string at the edge, per CLAUDE.md
 *   - null / boolean / string -> as-is
 *   - arrays and maps      -> recursively converted
 */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** What a DocumentReference looks like without importing the class (which needs a live Firestore). */
function isDocumentReferenceLike(value: object): value is { path: string } {
  return "path" in value && typeof value.path === "string" && "firestore" in value;
}

export function toJsonValue(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof GeoPoint) return { latitude: value.latitude, longitude: value.longitude };
  if (value instanceof Uint8Array) return Buffer.from(value).toString("base64");
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (typeof value === "object") {
    if (isDocumentReferenceLike(value)) return { _referencePath: value.path };
    const result: { [key: string]: JsonValue } = {};
    for (const [key, field] of Object.entries(value)) {
      result[key] = toJsonValue(field);
    }
    return result;
  }
  // Functions, symbols: nothing Firestore stores. Dropped explicitly.
  return null;
}

/**
 * The shape every exported document takes: the Firestore id kept apart from
 * the fields, so a field that happens to be called "id" can never collide
 * with or hide it.
 */
export interface ExportedDocument {
  id: string;
  data: { [key: string]: JsonValue };
}

export function toExportedDocument(id: string, fields: Record<string, unknown>): ExportedDocument {
  const data = toJsonValue(fields);
  // toJsonValue returns an object for any plain-object input; the cast only
  // narrows the union for the caller.
  return { id, data: data as { [key: string]: JsonValue } };
}
