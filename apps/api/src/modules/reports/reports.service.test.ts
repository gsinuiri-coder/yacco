import { describe, expect, test } from "@jest/globals";
import { Prisma } from "@prisma/client";
import { replayDebt } from "./reports.service.js";

const charge = (at: string, amount: string) => ({
  at: new Date(at),
  delta: new Prisma.Decimal(amount),
  isCharge: true,
});
const pay = (at: string, amount: string) => ({
  at: new Date(at),
  delta: new Prisma.Decimal(amount).negated(),
  isCharge: false,
});

describe("replayDebt", () => {
  test("un cobro exacto a la misma hora que el cargo lo cierra, sin importar el orden de llegada", () => {
    const at = "2026-09-01T10:00:00Z";
    const result = replayDebt([pay(at, "10.00"), charge(at, "10.00")]);
    expect(result.debt.toFixed(2)).toBe("0.00");
    expect(result.openSince).toBeNull();
  });

  test("con saldo a favor, el cargo que no lo agota no abre deuda: la abre el que lo pasa a deber", () => {
    const result = replayDebt([
      pay("2026-09-01T10:00:00Z", "15.00"),
      charge("2026-09-02T10:00:00Z", "10.00"),
      charge("2026-09-03T10:00:00Z", "10.00"),
    ]);
    expect(result.debt.toFixed(2)).toBe("5.00");
    expect(result.openSince?.toISOString()).toBe("2026-09-03T10:00:00.000Z");
  });

  test("sin movimientos no hay deuda", () => {
    expect(replayDebt([]).openSince).toBeNull();
  });
});
