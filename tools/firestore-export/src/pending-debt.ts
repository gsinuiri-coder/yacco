import type { ExportedDocument, JsonValue } from "./convert.js";

/**
 * A voucher as exported: its own fields plus the `debtPays` subcollection
 * nested inside, already converted to JSON.
 */
export interface ExportedVoucher extends ExportedDocument {
  debtPays: ExportedDocument[];
}

/** Reads a numeric field tolerantly: absent, null or non-numeric counts as 0. */
export function numberField(data: { [key: string]: JsonValue }, key: string): number {
  const value = data[key];
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return 0;
}

/** Sum of the `amount` field across the voucher's debtPays. */
export function sumDebtPays(voucher: ExportedVoucher): number {
  return voucher.debtPays.reduce((sum, pay) => sum + numberField(pay.data, "amount"), 0);
}

/**
 * THE ONE PLACE that decides whether a voucher still has debt outstanding.
 *
 * It is not yet confirmed how the old system represents what is owed. Two
 * candidate readings, both computed here so switching is a one-line change:
 *
 *   (A) `total` minus the voucher's own `debtPaid` field — a running figure
 *       the old app kept up to date on each payment.
 *   (B) `total` minus the SUM of `amount` over the `debtPays` subcollection —
 *       the same thing rebuilt from the payment records.
 *
 * They should agree; if they don't, the old app drifted and the loader has
 * to see both. Until confirmed against real data this uses (A), because
 * it is what the old app itself displayed to the owner, and falls back to
 * (B) only when the voucher has no `debtPaid` field at all.
 *
 * Field names (`total`, `debtPaid`, `debtPays[].amount`) are the assumed
 * ones; correct them here, and only here, once the snapshot is inspected.
 *
 * Any positive remainder counts as pending. Floating-point noise from the
 * old system (e.g. 0.004999) is treated as settled: the loader, not this
 * script, decides what to do with cents.
 */
const SETTLED_TOLERANCE = 0.005;

export function outstandingAmount(voucher: ExportedVoucher): number {
  const total = numberField(voucher.data, "total");
  const hasDebtPaidField = voucher.data.debtPaid !== undefined && voucher.data.debtPaid !== null;
  const paid = hasDebtPaidField ? numberField(voucher.data, "debtPaid") : sumDebtPays(voucher);
  return total - paid;
}

export function hasPendingDebt(voucher: ExportedVoucher): boolean {
  return outstandingAmount(voucher) > SETTLED_TOLERANCE;
}
