import { describe, expect, it } from "vitest";
import { formatBusinessDate } from "./business-date";

describe("formatBusinessDate", () => {
  it("formats a calendar day without going through Date", () => {
    expect(formatBusinessDate("2026-08-25")).toBe("25/08/2026");
  });

  it("keeps the year boundary exact — the day new Date() would shift", () => {
    // new Date("2026-01-01") is UTC midnight, which reads back as
    // 2025-12-31 in America/Lima (UTC-5). Text splitting cannot drift.
    expect(formatBusinessDate("2026-01-01")).toBe("01/01/2026");
    expect(formatBusinessDate("2025-12-31")).toBe("31/12/2025");
  });

  it("returns the raw value when it does not match AAAA-MM-DD", () => {
    expect(formatBusinessDate("not-a-date")).toBe("not-a-date");
  });
});
