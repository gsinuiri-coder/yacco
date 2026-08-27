import {
  DEMO_CUSTOMERS,
  DEMO_DELIVERIES,
  DEMO_HISTORY_DAYS,
  PRODUCT_NAMES,
  PRODUCT_UNIT_PRICE,
  businessDatesGoingBack,
  computeExpectedDebtByCustomer,
  deliveriesByDay,
  findProductPriceMismatches,
  loadsNeededByDay,
} from "./seed-demo-plan.js";

describe("businessDatesGoingBack", () => {
  test("returns `count` dates, oldest first, ending at the reference day", () => {
    // Noon UTC on 2026-08-27 is still 2026-08-27 in America/Lima (UTC-5).
    const dates = businessDatesGoingBack(5, new Date("2026-08-27T12:00:00Z"));

    expect(dates).toEqual(["2026-08-23", "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27"]);
  });

  test("reads the Lima calendar day, not the UTC day, near the UTC-5 boundary", () => {
    // 02:00 UTC on 2026-08-27 is still 21:00 on 2026-08-26 in America/Lima —
    // this is exactly the off-by-one CLAUDE.md's date rule warns about.
    const dates = businessDatesGoingBack(1, new Date("2026-08-27T02:00:00Z"));

    expect(dates).toEqual(["2026-08-26"]);
  });

  test("crosses a month boundary correctly", () => {
    const dates = businessDatesGoingBack(3, new Date("2026-09-01T12:00:00Z"));

    expect(dates).toEqual(["2026-08-30", "2026-08-31", "2026-09-01"]);
  });
});

describe("deliveriesByDay", () => {
  test("groups every delivery under its dayIndex", () => {
    const byDay = deliveriesByDay(DEMO_DELIVERIES);

    const total = [...byDay.values()].reduce((sum, list) => sum + list.length, 0);
    expect(total).toBe(DEMO_DELIVERIES.length);
    for (let dayIndex = 0; dayIndex < DEMO_HISTORY_DAYS; dayIndex += 1) {
      expect((byDay.get(dayIndex) ?? []).length).toBeGreaterThan(0);
    }
  });
});

describe("loadsNeededByDay", () => {
  test("matches the hand-computed per-day container totals", () => {
    const loads = loadsNeededByDay(DEMO_DELIVERIES);

    expect(loads.get(0)).toEqual({ CON_CANO: 9 });
    expect(loads.get(1)).toEqual({ CON_CANO: 10, SIN_CANO: 5 });
    expect(loads.get(2)).toEqual({ CON_CANO: 12, SIN_CANO: 3 });
    expect(loads.get(3)).toEqual({ CON_CANO: 6 });
    expect(loads.get(4)).toEqual({ CON_CANO: 4, SIN_CANO: 2 });
  });

  test("grand totals stay within the production batch's buffer", () => {
    const loads = loadsNeededByDay(DEMO_DELIVERIES);
    let conCano = 0;
    let sinCano = 0;
    for (const byType of loads.values()) {
      conCano += byType.CON_CANO ?? 0;
      sinCano += byType.SIN_CANO ?? 0;
    }

    expect(conCano).toBe(41);
    expect(sinCano).toBe(10);
    // PRODUCTION_PLAN produces 60 / 20 — must stay ahead of what's loaded.
    expect(conCano).toBeLessThan(60);
    expect(sinCano).toBeLessThan(20);
  });
});

describe("computeExpectedDebtByCustomer", () => {
  test("matches the hand-computed debt for every demo customer", () => {
    const debts = computeExpectedDebtByCustomer(DEMO_DELIVERIES);

    expect(debts.get("estrella")).toBe("148.00");
    expect(debts.get("debt0_a")).toBe("0.00");
    expect(debts.get("debt0_b")).toBe("0.00");
    expect(debts.get("small_a")).toBe("16.00");
    expect(debts.get("small_b")).toBe("24.00");
    expect(debts.get("near_limit")).toBe("64.00");
    expect(debts.get("pending_yape")).toBe("16.00");
    expect(debts.get("pending_transferencia")).toBe("24.00");
  });

  test("covers every demo customer, in the same order DEMO_CUSTOMERS declares them", () => {
    const debts = computeExpectedDebtByCustomer(DEMO_DELIVERIES);
    expect([...debts.keys()]).toEqual(DEMO_CUSTOMERS.map((customer) => customer.key));
  });

  test("the demo profile has exactly one star (3-figure debt) and two debt-free customers", () => {
    const debts = [...computeExpectedDebtByCustomer(DEMO_DELIVERIES).values()].map(Number);

    expect(debts.filter((debt) => debt >= 100)).toHaveLength(1);
    expect(debts.filter((debt) => debt === 0)).toHaveLength(2);
  });

  test("the near-limit customer stays under its own creditLimit", () => {
    const debts = computeExpectedDebtByCustomer(DEMO_DELIVERIES);
    const nearLimit = DEMO_CUSTOMERS.find((customer) => customer.key === "near_limit");
    expect(nearLimit?.creditLimit).toBeDefined();

    const debt = Number(debts.get("near_limit"));
    const limit = Number(nearLimit?.creditLimit);
    expect(debt).toBeLessThan(limit);
    expect(debt / limit).toBeGreaterThan(0.8); // "close to" the limit, not just under it.
  });

  test("a PENDING payment (Yape/Transferencia) never reduces debt, unlike a CONFIRMED Efectivo one", () => {
    const debts = computeExpectedDebtByCustomer(DEMO_DELIVERIES);
    // pending_yape: 2 x R_SC (16.00) with a PENDING Yape payment of the same
    // amount — if PENDING wrongly reduced debt, this would be "0.00".
    expect(debts.get("pending_yape")).toBe("16.00");
  });
});

describe("findProductPriceMismatches", () => {
  const realCatalog = (Object.keys(PRODUCT_NAMES) as (keyof typeof PRODUCT_NAMES)[]).map((key) => ({
    name: PRODUCT_NAMES[key],
    listPrice: PRODUCT_UNIT_PRICE[key],
  }));

  test("no mismatches when the catalog agrees with the plan", () => {
    expect(findProductPriceMismatches(realCatalog)).toEqual([]);
  });

  test("reports a product whose real listPrice disagrees with the plan", () => {
    const catalog = realCatalog.map((product) =>
      product.name === PRODUCT_NAMES.R_CC ? { ...product, listPrice: "9.50" } : product,
    );

    const mismatches = findProductPriceMismatches(catalog);
    expect(mismatches).toEqual([
      { key: "R_CC", name: PRODUCT_NAMES.R_CC, expected: PRODUCT_UNIT_PRICE.R_CC, actual: "9.50" },
    ]);
  });

  test("reports every mismatched product, not just the first", () => {
    const catalog = realCatalog.map((product) => ({ ...product, listPrice: "1.00" }));

    const mismatches = findProductPriceMismatches(catalog);
    expect(mismatches).toHaveLength(realCatalog.length);
  });

  test("a product missing from the catalog entirely is not reported here (CatalogIds' job)", () => {
    expect(findProductPriceMismatches([])).toEqual([]);
  });

  test("an unrelated product in the catalog is ignored", () => {
    const catalog = [...realCatalog, { name: "Otro producto", listPrice: "1.00" }];
    expect(findProductPriceMismatches(catalog)).toEqual([]);
  });
});

describe("demo roster shape", () => {
  test("exactly 8 customers, each with a unique key", () => {
    expect(DEMO_CUSTOMERS).toHaveLength(8);
    expect(new Set(DEMO_CUSTOMERS.map((customer) => customer.key)).size).toBe(8);
  });

  test("every delivery references a customer that actually exists in the roster", () => {
    const knownKeys = new Set(DEMO_CUSTOMERS.map((customer) => customer.key));
    for (const delivery of DEMO_DELIVERIES) {
      expect(knownKeys.has(delivery.customerKey)).toBe(true);
    }
  });

  test("every delivery falls within the declared history window", () => {
    for (const delivery of DEMO_DELIVERIES) {
      expect(delivery.dayIndex).toBeGreaterThanOrEqual(0);
      expect(delivery.dayIndex).toBeLessThan(DEMO_HISTORY_DAYS);
    }
  });
});
