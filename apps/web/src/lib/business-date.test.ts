import { afterEach, describe, expect, it, vi } from "vitest";
import { formatBusinessDate, todayInLima } from "./business-date";

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

describe("todayInLima", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads the Lima calendar day, not the UTC one", () => {
    // 02:00 UTC on the 25th is still 21:00 on the 24th in Lima (UTC-5).
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T02:00:00.000Z"));
    expect(todayInLima()).toBe("2026-08-24");
  });

  it("rolls over once the instant is past the Lima offset", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T06:00:00.000Z"));
    expect(todayInLima()).toBe("2026-08-25");
  });
});
