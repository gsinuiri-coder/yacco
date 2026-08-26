import { limaCutoverInstant } from "./roster-loader.service.js";

describe("limaCutoverInstant", () => {
  it("resolves a Lima calendar day to its 05:00 UTC midnight instant", () => {
    expect(limaCutoverInstant("2026-08-25").toISOString()).toBe("2026-08-25T05:00:00.000Z");
  });

  it("never lands in the wrong month for an end-of-month cutover", () => {
    // new Date("2026-08-31") would read back as 2026-08-30 in Lima (UTC-5).
    expect(limaCutoverInstant("2026-08-31").toISOString()).toBe("2026-08-31T05:00:00.000Z");
  });

  it("rejects a date not in AAAA-MM-DD format", () => {
    expect(() => limaCutoverInstant("31/08/2026")).toThrow(/AAAA-MM-DD/);
    expect(() => limaCutoverInstant("2026-8-31")).toThrow(/AAAA-MM-DD/);
    expect(() => limaCutoverInstant("")).toThrow(/AAAA-MM-DD/);
  });
});
