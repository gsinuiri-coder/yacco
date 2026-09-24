import { describe, expect, it } from "vitest";
import type { JsonValue } from "./convert.js";
import { hasPendingDebt, numberField, outstandingAmount, sumDebtPays } from "./pending-debt.js";
import type { ExportedVoucher } from "./pending-debt.js";

function buildVoucher(
  data: { [key: string]: JsonValue },
  debtPays: { [key: string]: JsonValue }[] = [],
): ExportedVoucher {
  return {
    id: "v-1",
    data,
    debtPays: debtPays.map((pay, index) => ({ id: `pay-${index}`, data: pay })),
  };
}

describe("numberField", () => {
  it("reads numbers, numeric strings, and treats anything else as 0", () => {
    expect(numberField({ total: 12.5 }, "total")).toBe(12.5);
    expect(numberField({ total: "8" }, "total")).toBe(8);
    expect(numberField({ total: "" }, "total")).toBe(0);
    expect(numberField({ total: "doce" }, "total")).toBe(0);
    expect(numberField({ total: null }, "total")).toBe(0);
    expect(numberField({}, "total")).toBe(0);
  });
});

describe("sumDebtPays", () => {
  it("adds the amount of every payment, ignoring malformed ones", () => {
    const voucher = buildVoucher({ total: 30 }, [{ amount: 10 }, { amount: "5" }, { note: "x" }]);

    expect(sumDebtPays(voucher)).toBe(15);
  });
});

describe("outstandingAmount / hasPendingDebt — the one place the criterion lives", () => {
  it("uses total minus debtPaid when the voucher carries a debtPaid field (reading A)", () => {
    const voucher = buildVoucher({ total: 30, debtPaid: 10 }, [{ amount: 5 }]);

    expect(outstandingAmount(voucher)).toBe(20);
    expect(hasPendingDebt(voucher)).toBe(true);
  });

  it("falls back to total minus the sum of debtPays when debtPaid is absent (reading B)", () => {
    const voucher = buildVoucher({ total: 30 }, [{ amount: 10 }, { amount: 20 }]);

    expect(outstandingAmount(voucher)).toBe(0);
    expect(hasPendingDebt(voucher)).toBe(false);
  });

  it("treats a null debtPaid as absent, not as zero paid", () => {
    const voucher = buildVoucher({ total: 30, debtPaid: null }, [{ amount: 30 }]);

    expect(hasPendingDebt(voucher)).toBe(false);
  });

  it("a voucher with nothing paid at all is pending", () => {
    expect(hasPendingDebt(buildVoucher({ total: 12 }))).toBe(true);
  });

  it("a voucher fully paid is not pending, even with floating-point noise", () => {
    expect(hasPendingDebt(buildVoucher({ total: 10, debtPaid: 10 }))).toBe(false);
    expect(hasPendingDebt(buildVoucher({ total: 0.3, debtPaid: 0.1 + 0.2 }))).toBe(false);
  });

  it("an overpaid voucher is not pending", () => {
    expect(hasPendingDebt(buildVoucher({ total: 10, debtPaid: 12 }))).toBe(false);
  });

  it("a voucher without a total owes nothing", () => {
    expect(hasPendingDebt(buildVoucher({ debtPaid: 0 }))).toBe(false);
  });
});
