import { describe, expect, it } from "vitest";
import {
  googleMapsDirectionsUrl,
  googleMapsLocationUrl,
  parseLocationCoordinates,
} from "../../app/utils/customer-location";

describe("parseLocationCoordinates", () => {
  it.each([
    ["-12.046374, -77.042793"],
    ["https://www.google.com/maps/place/Lima/@-12.046374,-77.042793,17z"],
    ["https://www.google.com/maps/search/?api=1&query=-12.046374%2C-77.042793"],
  ])("extrae latitud y longitud de %s", (input) => {
    expect(parseLocationCoordinates(input)).toEqual({
      latitude: "-12.046374",
      longitude: "-77.042793",
    });
  });

  it.each(["texto sin coordenadas", "91, -77", "-12, 181"])(
    "rechaza una ubicación inválida: %s",
    (input) => {
      expect(parseLocationCoordinates(input)).toBeNull();
    },
  );
});

describe("Google Maps URLs", () => {
  it("abre el punto guardado desde la ficha", () => {
    expect(googleMapsLocationUrl("-12.046374", "-77.042793")).toBe(
      "https://www.google.com/maps/search/?api=1&query=-12.046374%2C-77.042793",
    );
  });

  it("abre indicaciones desde Mi ruta", () => {
    expect(googleMapsDirectionsUrl("-12.046374", "-77.042793")).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=-12.046374%2C-77.042793",
    );
  });
});
