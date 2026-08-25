import { computeRosterAggregates } from "./roster-aggregates.js";
import type { ValidatedRoster } from "./roster-loader.types.js";

function buildRoster(overrides: Partial<ValidatedRoster> = {}): ValidatedRoster {
  return {
    customers: [
      {
        externalCode: "C-1",
        name: "Uno",
        phone: "1",
        zoneName: "Surco",
        status: "ACTIVE",
        line: 2,
      },
      {
        externalCode: "C-2",
        name: "Dos",
        phone: "2",
        zoneName: "Surco",
        status: "INACTIVE",
        line: 3,
      },
      { externalCode: "C-3", name: "Tres", phone: "3", zoneName: null, status: "ACTIVE", line: 4 },
    ],
    locationsByCustomerCode: new Map([
      [
        "C-1",
        [
          {
            locationCode: "L-1",
            customerCode: "C-1",
            label: "Casa",
            address: "",
            addressReference: "",
            isPrimary: true,
            line: 2,
          },
        ],
      ],
      [
        "C-2",
        [
          {
            locationCode: "L-2",
            customerCode: "C-2",
            label: "Local",
            address: "",
            addressReference: "",
            isPrimary: true,
            line: 3,
          },
          {
            locationCode: "L-2B",
            customerCode: "C-2",
            label: "Depósito",
            address: "",
            addressReference: "",
            isPrimary: false,
            line: 4,
          },
        ],
      ],
      [
        "C-3",
        [
          {
            locationCode: "L-3",
            customerCode: "C-3",
            label: "Casa",
            address: "",
            addressReference: "",
            isPrimary: true,
            line: 5,
          },
        ],
      ],
    ]),
    containersByLocationCode: new Map([
      ["L-1", { locationCode: "L-1", qtySpout: 2, qtyNoSpout: 0, confidence: "HIGH", line: 2 }],
      [
        "L-2",
        { locationCode: "L-2", qtySpout: 5, qtyNoSpout: 3, confidence: "ESTIMATED", line: 3 },
      ],
      [
        "L-2B",
        { locationCode: "L-2B", qtySpout: 0, qtyNoSpout: 0, confidence: "ESTIMATED", line: 4 },
      ],
      ["L-3", { locationCode: "L-3", qtySpout: 1, qtyNoSpout: 0, confidence: "HIGH", line: 5 }],
    ]),
    moneyByCustomerCode: new Map([
      ["C-1", { customerCode: "C-1", amount: "45.00", line: 2 }],
      ["C-2", { customerCode: "C-2", amount: "-60.00", line: 3 }],
    ]),
    ...overrides,
  };
}

describe("computeRosterAggregates", () => {
  it("counts customers total/active/inactive", () => {
    const aggregates = computeRosterAggregates(buildRoster());
    expect(aggregates.customers).toEqual({ total: 3, active: 2, inactive: 1 });
  });

  it("distributes customers by zone, grouping no-zone under a fixed label", () => {
    const aggregates = computeRosterAggregates(buildRoster());
    expect(Object.fromEntries(aggregates.customersByZone)).toEqual({
      Surco: 2,
      "(sin zona)": 1,
    });
  });

  it("counts every location across every customer", () => {
    const aggregates = computeRosterAggregates(buildRoster());
    expect(aggregates.locations.total).toBe(4);
  });

  it("sums container quantities by resolved type name, ignoring zero-quantity rows", () => {
    const aggregates = computeRosterAggregates(buildRoster());
    expect(Object.fromEntries(aggregates.containerTotalsByType)).toEqual({
      "Con caño": 2 + 5 + 1,
      "Sin caño": 3,
    });
  });

  it("counts an ESTIMATED location with at least one positive quantity as pending to count", () => {
    const aggregates = computeRosterAggregates(buildRoster());
    // L-2 is ESTIMATED with qty>0 -> pending. L-2B is ESTIMATED but all-zero -> not pending.
    expect(aggregates.pendingToCount).toBe(1);
  });

  it("nets the debt total as a fixed 2-decimal string, charges minus credits", () => {
    const aggregates = computeRosterAggregates(buildRoster());
    expect(aggregates.netDebtTotal).toBe("-15.00");
  });

  it("returns zeros and empty maps for a roster with no locations, containers or money", () => {
    const aggregates = computeRosterAggregates({
      customers: [],
      locationsByCustomerCode: new Map(),
      containersByLocationCode: new Map(),
      moneyByCustomerCode: new Map(),
    });
    expect(aggregates).toEqual({
      customers: { total: 0, active: 0, inactive: 0 },
      customersByZone: new Map(),
      locations: { total: 0 },
      containerTotalsByType: new Map(),
      pendingToCount: 0,
      netDebtTotal: "0.00",
    });
  });
});
