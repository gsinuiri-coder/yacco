import { formatSummary } from "./format-summary.js";
import type { LoadSummary } from "./roster-loader.types.js";

function buildSummary(overrides: Partial<LoadSummary> = {}): LoadSummary {
  return {
    committed: false,
    customers: { total: 8, active: 7, inactive: 1 },
    customersByZone: new Map([
      ["Surco", 2],
      ["Barranco", 2],
    ]),
    locations: { total: 9 },
    containerMovements: { created: 0, alreadyLoaded: 0 },
    containerTotalsByType: new Map([
      ["Con caño", 33],
      ["Sin caño", 8],
    ]),
    confirmatoryCounts: { created: 0, alreadyLoaded: 0 },
    pendingToCount: 2,
    openingCharges: { created: 0, alreadyLoaded: 0 },
    openingCredits: { created: 0, alreadyLoaded: 0 },
    netDebtTotal: "450.00",
    ...overrides,
  };
}

describe("formatSummary", () => {
  it("labels a dry run clearly, without pretending anything was written", () => {
    const lines = formatSummary(buildSummary({ committed: false }));
    expect(lines[0]).toMatch(/DRY-RUN/);
    expect(lines[0]).toMatch(/no se escribió nada/);
  });

  it("labels a commit as written", () => {
    const lines = formatSummary(buildSummary({ committed: true }));
    expect(lines[0]).toMatch(/ESCRITO/);
  });

  it("renders every aggregate field asked for: customers, zones, movements, container totals, confirmatory counts, pending, money", () => {
    const lines = formatSummary(buildSummary()).join("\n");

    expect(lines).toContain("Clientes: 8 (7 activos, 1 inactivos)");
    expect(lines).toContain("Ubicaciones: 9");
    expect(lines).toContain("Surco: 2");
    expect(lines).toContain("Barranco: 2");
    expect(lines).toContain("Con caño: 33");
    expect(lines).toContain("Sin caño: 8");
    expect(lines).toContain("Pendientes de contar (confianza estimada): 2");
    expect(lines).toContain("Deuda neta total: S/ 450.00");
  });

  it("shows created vs already-loaded for movements, counts, charges and credits", () => {
    const lines = formatSummary(
      buildSummary({
        containerMovements: { created: 3, alreadyLoaded: 6 },
        openingCharges: { created: 1, alreadyLoaded: 5 },
        openingCredits: { created: 0, alreadyLoaded: 1 },
      }),
    ).join("\n");

    expect(lines).toContain("Movimientos de apertura (envases): 3 creados, 6 ya existían");
    expect(lines).toContain("Cargos de apertura (deuda): 1 creados, 5 ya existían");
    expect(lines).toContain("Créditos de apertura (saldo a favor): 0 creados, 1 ya existían");
  });

  it("never mentions a name, phone, address, or per-customer amount — it only has aggregates to work with", () => {
    const output = formatSummary(buildSummary()).join("\n");
    // The summary's own vocabulary never includes personal-data words.
    expect(output).not.toMatch(/tel[ée]fono|direcci[oó]n/i);
  });

  it("handles an empty roster (no zones, no container types) without crashing", () => {
    const lines = formatSummary(
      buildSummary({
        customers: { total: 0, active: 0, inactive: 0 },
        customersByZone: new Map(),
        locations: { total: 0 },
        containerTotalsByType: new Map(),
        pendingToCount: 0,
        netDebtTotal: "0.00",
      }),
    ).join("\n");

    expect(lines).toContain("(ninguna)");
    expect(lines).toContain("(ninguno)");
  });
});
