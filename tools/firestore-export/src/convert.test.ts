import { GeoPoint, Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { toExportedDocument, toJsonValue } from "./convert.js";

describe("toJsonValue", () => {
  it("converts a Timestamp to an ISO-8601 UTC string", () => {
    const timestamp = Timestamp.fromDate(new Date("2025-03-01T14:05:00.250Z"));

    expect(toJsonValue(timestamp)).toBe("2025-03-01T14:05:00.250Z");
  });

  it("converts a Date the same way, so a second pass over converted data is harmless", () => {
    expect(toJsonValue(new Date("2024-12-31T23:59:59.000Z"))).toBe("2024-12-31T23:59:59.000Z");
  });

  it("leaves numbers as they are, integers and decimals alike", () => {
    expect(toJsonValue(12)).toBe(12);
    expect(toJsonValue(12.5)).toBe(12.5);
    expect(toJsonValue(0)).toBe(0);
    expect(toJsonValue(-3.25)).toBe(-3.25);
  });

  it("turns NaN and Infinity into null, which JSON cannot carry", () => {
    expect(toJsonValue(Number.NaN)).toBeNull();
    expect(toJsonValue(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("passes strings, booleans and null through; undefined becomes null", () => {
    expect(toJsonValue("Bodega Santa Rosa")).toBe("Bodega Santa Rosa");
    expect(toJsonValue(true)).toBe(true);
    expect(toJsonValue(null)).toBeNull();
    expect(toJsonValue(undefined)).toBeNull();
  });

  it("converts a GeoPoint to latitude/longitude", () => {
    expect(toJsonValue(new GeoPoint(-12.0464, -77.0428))).toEqual({
      latitude: -12.0464,
      longitude: -77.0428,
    });
  });

  it("converts bytes to base64", () => {
    expect(toJsonValue(Buffer.from("hola"))).toBe("aG9sYQ==");
    expect(toJsonValue(new Uint8Array([104, 105]))).toBe("aGk=");
  });

  it("keeps only the path of a document reference", () => {
    const reference = { path: "customers/abc123", id: "abc123", firestore: {} };

    expect(toJsonValue(reference)).toEqual({ _referencePath: "customers/abc123" });
  });

  it("recurses into arrays and maps, converting nested Timestamps", () => {
    const createdAt = Timestamp.fromDate(new Date("2025-01-10T10:00:00.000Z"));

    expect(
      toJsonValue({
        name: "Kiosko",
        tags: ["a", 2, null],
        history: [{ at: createdAt, amount: 5 }],
        nested: { deeper: { at: createdAt } },
      }),
    ).toEqual({
      name: "Kiosko",
      tags: ["a", 2, null],
      history: [{ at: "2025-01-10T10:00:00.000Z", amount: 5 }],
      nested: { deeper: { at: "2025-01-10T10:00:00.000Z" } },
    });
  });

  it("drops functions and stringifies bigints, neither of which Firestore stores", () => {
    expect(toJsonValue(() => 1)).toBeNull();
    expect(toJsonValue(BigInt(7))).toBe("7");
  });
});

describe("toExportedDocument", () => {
  it("keeps the Firestore id apart from the fields, so a field called id cannot hide it", () => {
    const exported = toExportedDocument("doc-1", { id: "field-id", total: 10 });

    expect(exported).toEqual({ id: "doc-1", data: { id: "field-id", total: 10 } });
  });
});
