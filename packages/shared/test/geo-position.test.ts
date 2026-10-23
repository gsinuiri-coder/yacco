import { describe, expect, it } from "vitest";
import { positionStrings } from "../src/geo-position.js";

describe("positionStrings", () => {
  it("deja la lectura como la toma la API: 6 decimales y la precisión con 2", () => {
    expect(
      positionStrings({ latitude: -12.0463741, longitude: -77.0427934, accuracy: 8.456 }),
    ).toEqual({ latitude: "-12.046374", longitude: "-77.042793", accuracyM: "8.46" });
  });

  it("descarta una lectura sin precisión, como la que puede dar el celular", () => {
    expect(positionStrings({ latitude: -12.04, longitude: -77.04, accuracy: null })).toBeNull();
  });

  it.each([
    { latitude: 91, longitude: -77, accuracy: 5 },
    { latitude: -12, longitude: -181, accuracy: 5 },
    { latitude: Number.NaN, longitude: -77, accuracy: 5 },
    { latitude: -12, longitude: -77, accuracy: -1 },
    { latitude: -12, longitude: -77, accuracy: 100_000_000 },
  ])("descarta lo que la API no aceptaría: %o", (reading) => {
    expect(positionStrings(reading)).toBeNull();
  });
});
