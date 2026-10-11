import { describe, expect, it } from "vitest";
import { buildGoogleMapsRouteLegs, proposeNearbyStopIds } from "../../app/utils/route-planning";

const plant = { latitude: "0.000000", longitude: "0.000000" };

function stop(id: string, latitude: string | null, longitude: string | null) {
  return { id, latitude, longitude };
}

describe("proposeNearbyStopIds", () => {
  it("elige siempre el vecino más cercano desde la planta y deja los faltantes al final", () => {
    expect(
      proposeNearbyStopIds(plant, [
        stop("sin-ubicacion", null, null),
        stop("este-2", "0.000000", "2.000000"),
        stop("este-1", "0.000000", "1.000000"),
        stop("oeste-1", "0.000000", "-1.000000"),
      ]),
    ).toEqual(["este-1", "este-2", "oeste-1", "sin-ubicacion"]);
  });

  it("ante dos distancias iguales conserva el orden actual", () => {
    expect(
      proposeNearbyStopIds(plant, [
        stop("oeste", "0.000000", "-1.000000"),
        stop("este", "0.000000", "1.000000"),
      ]),
    ).toEqual(["oeste", "este"]);
  });
});

describe("buildGoogleMapsRouteLegs", () => {
  it("usa como máximo tres puntos intermedios y enlaza cada tramo desde el final del anterior", () => {
    const stops = Array.from({ length: 10 }, (_, index) =>
      stop(`s-${index + 1}`, "0.000000", `${index + 1}.000000`),
    );

    const legs = buildGoogleMapsRouteLegs(plant, stops);

    expect(legs.map((leg) => leg.stopIds)).toEqual([
      ["s-1", "s-2", "s-3", "s-4"],
      ["s-5", "s-6", "s-7", "s-8"],
      ["s-9", "s-10"],
    ]);
    expect(legs[0]!.url).toBe(
      "https://www.google.com/maps/dir/?api=1&origin=0.000000%2C0.000000&destination=0.000000%2C4.000000&travelmode=driving&waypoints=0.000000%2C1.000000%7C0.000000%2C2.000000%7C0.000000%2C3.000000",
    );
    expect(legs[1]!.url).toContain("origin=0.000000%2C4.000000");
    expect(legs[1]!.url).toContain("destination=0.000000%2C8.000000");
    expect(legs[2]!.url).toContain("origin=0.000000%2C8.000000");
    expect(legs[2]!.url).toContain("destination=0.000000%2C10.000000");
  });

  it("omite del mapa las paradas sin coordenadas", () => {
    expect(
      buildGoogleMapsRouteLegs(plant, [
        stop("sin-ubicacion", null, null),
        stop("ubicada", "-12.100000", "-77.100000"),
      ]).map((leg) => leg.stopIds),
    ).toEqual([["ubicada"]]);
  });
});
