import type { RouteStop, StopStatus } from "@yacco/shared";
import { describe, expect, it } from "vitest";
import { summarizeStops } from "../../app/utils/route-status";

function stops(...statuses: StopStatus[]): { stops: RouteStop[] } {
  return { stops: statuses.map((status) => ({ status }) as RouteStop) };
}

describe("summarizeStops", () => {
  it("una ruta sin paradas lo dice", () => {
    expect(summarizeStops(stops())).toEqual({ total: "Sin paradas", resolved: null });
  });

  it("con todo pendiente no desglosa: «2 pendientes» bajo «2 paradas» no dice nada", () => {
    expect(summarizeStops(stops("PENDING", "PENDING"))).toEqual({
      total: "2 paradas",
      resolved: null,
    });
  });

  it("desglosa en singular y plural apenas se resuelve alguna", () => {
    expect(summarizeStops(stops("DELIVERED", "PENDING"))).toEqual({
      total: "2 paradas",
      resolved: "1 entregada · 1 pendiente",
    });
    expect(summarizeStops(stops("FAILED", "FAILED", "DELIVERED", "DELIVERED"))).toEqual({
      total: "4 paradas",
      resolved: "2 entregadas · 2 no entregadas",
    });
    expect(summarizeStops(stops("DELIVERED"))).toEqual({
      total: "1 parada",
      resolved: "1 entregada",
    });
  });
});
