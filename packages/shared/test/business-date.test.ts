import { describe, expect, it } from "vitest";
import { formatCalendarDay, formatInstantInLima, limaToday } from "../src/business-date.js";

describe("formatCalendarDay", () => {
  it("formatea el día partiendo el texto", () => {
    expect(formatCalendarDay("2026-08-25")).toBe("25/08/2026");
  });

  it("no corre el día en el cambio de año, que es donde new Date() lo corre en Lima", () => {
    // new Date("2026-01-01") es medianoche UTC: en Lima (UTC-5) se lee 31/12/2025.
    expect(new Date("2026-01-01").toLocaleDateString("en-CA", { timeZone: "America/Lima" })).toBe(
      "2025-12-31",
    );
    expect(formatCalendarDay("2026-01-01")).toBe("01/01/2026");
  });

  it("devuelve intacto lo que no es AAAA-MM-DD", () => {
    expect(formatCalendarDay("no-es-fecha")).toBe("no-es-fecha");
    expect(formatCalendarDay("2026-08-25T00:00:00Z")).toBe("2026-08-25T00:00:00Z");
  });
});

describe("limaToday", () => {
  it("lee el día de Lima, no el de UTC", () => {
    // 02:00 UTC del 25 son las 21:00 del 24 en Lima.
    expect(limaToday(new Date("2026-08-25T02:00:00.000Z"))).toBe("2026-08-24");
    expect(limaToday(new Date("2026-08-25T05:00:00.000Z"))).toBe("2026-08-25");
  });

  it("sin argumento usa el instante actual", () => {
    expect(limaToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("formatInstantInLima", () => {
  it("muestra el instante en la hora de Lima, reloj de 24 horas", () => {
    expect(formatInstantInLima("2026-08-25T15:04:00.000Z")).toBe("25/08/2026 10:04");
    expect(formatInstantInLima("2026-08-25T04:30:00.000Z")).toBe("24/08/2026 23:30");
  });

  it("devuelve intacto lo que no se puede leer como instante", () => {
    expect(formatInstantInLima("ayer")).toBe("ayer");
  });
});
