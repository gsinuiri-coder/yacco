import { describe, expect, it } from "vitest";
import { mapPoint, minutesAgoText } from "../../app/utils/route-map";

const NOW = new Date("2026-10-19T15:00:00.000Z");

function minutesBefore(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

describe("minutesAgoText", () => {
  it("dice cuánto hace en minutos, y en horas pasada la hora", () => {
    expect(minutesAgoText(minutesBefore(0), NOW)).toBe("hace menos de un minuto");
    expect(minutesAgoText(minutesBefore(1), NOW)).toBe("hace 1 minuto");
    expect(minutesAgoText(minutesBefore(20), NOW)).toBe("hace 20 minutos");
    expect(minutesAgoText(minutesBefore(60), NOW)).toBe("hace 1 h");
    expect(minutesAgoText(minutesBefore(125), NOW)).toBe("hace 2 h 5 min");
  });

  it("un reloj del celular adelantado no da un número negativo", () => {
    expect(minutesAgoText(minutesBefore(-3), NOW)).toBe("hace menos de un minuto");
  });
});

describe("mapPoint", () => {
  it("convierte las coordenadas de texto, y sin una de las dos no hay punto", () => {
    expect(mapPoint("-12.046374", "-77.042793")).toEqual({
      latitude: -12.046374,
      longitude: -77.042793,
    });
    expect(mapPoint(null, "-77.042793")).toBeNull();
    expect(mapPoint("-12.046374", null)).toBeNull();
    expect(mapPoint("abc", "-77.042793")).toBeNull();
  });
});
