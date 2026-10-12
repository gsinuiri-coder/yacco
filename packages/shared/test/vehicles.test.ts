import { describe, expect, it } from "vitest";
import { calculateReviewStatus, normalizePlate } from "../src/vehicles.js";

describe("normalizePlate", () => {
  it("elimina guiones y espacios y convierte a mayúsculas", () => {
    expect(normalizePlate("abc-123")).toBe("ABC123");
    expect(normalizePlate("  xyz - 789  ")).toBe("XYZ789");
    expect(normalizePlate("p3o-900")).toBe("P3O900");
  });

  it("elimina caracteres especiales", () => {
    expect(normalizePlate("ab.c/1-2#3")).toBe("ABC123");
  });
});

describe("calculateReviewStatus", () => {
  it("determina 'VENCIDA' si la fecha de fin es anterior a hoy", () => {
    const res = calculateReviewStatus("2026-10-01", "2026-10-12");
    expect(res.status).toBe("VENCIDA");
    expect(res.daysRemaining).toBe(-11);
  });

  it("determina 'POR_VENCER' si faltan 15 días o menos", () => {
    const resToday = calculateReviewStatus("2026-10-12", "2026-10-12");
    expect(resToday.status).toBe("POR_VENCER");
    expect(resToday.daysRemaining).toBe(0);

    const res15 = calculateReviewStatus("2026-10-27", "2026-10-12");
    expect(res15.status).toBe("POR_VENCER");
    expect(res15.daysRemaining).toBe(15);
  });

  it("determina 'VIGENTE' si faltan más de 15 días", () => {
    const res16 = calculateReviewStatus("2026-10-28", "2026-10-12");
    expect(res16.status).toBe("VIGENTE");
    expect(res16.daysRemaining).toBe(16);

    const resFuture = calculateReviewStatus("2027-10-12", "2026-10-12");
    expect(resFuture.status).toBe("VIGENTE");
    expect(resFuture.daysRemaining).toBe(365);
  });
});
