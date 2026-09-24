import { describe, expect, it } from "vitest";
import { runRoster } from "./roster-cli.js";
import type { RosterCliDeps } from "./roster-cli.js";

function fakeDeps(customersJson: string | Error) {
  const written = new Map<string, string>();
  const logs: string[] = [];
  const errors: string[] = [];
  const deps: RosterCliDeps = {
    readFile: () => {
      if (customersJson instanceof Error) throw customersJson;
      return customersJson;
    },
    mkdir: () => undefined,
    writeFile: (file, contents) => written.set(file.replaceAll("\\", "/"), contents),
    log: (message) => logs.push(message),
    error: (message) => errors.push(message),
  };
  return { deps, written, logs, errors };
}

const ONE = JSON.stringify([
  { id: "a", data: { name: "Ana", phone: "987654321", locations: [{ address: "Jr. 1" }] } },
  { id: "b", data: { name: " ", phone: "987654322", locations: [{ address: "Jr. 2" }] } },
]);

describe("runRoster", () => {
  it("escribe los 4 CSV y el reporte, y la consola solo muestra cuentas", () => {
    const { deps, written, logs } = fakeDeps(ONE);

    expect(runRoster(["--in", "exp", "--out", "csv"], deps)).toBe(0);

    expect([...written.keys()].sort()).toEqual([
      "csv/customers.csv",
      "csv/locations.csv",
      "csv/opening_containers.csv",
      "csv/opening_money.csv",
      "csv/report.json",
    ]);
    expect(logs).toEqual(["Leídos 2; entran 1.", "  descartados, sin nombre: 1"]);
    expect(logs.join(" ")).not.toContain("Ana");
  });

  it("sin --in o --out explica el uso", () => {
    const { deps, errors } = fakeDeps(ONE);
    expect(runRoster(["--in", "exp"], deps)).toBe(2);
    expect(errors[0]).toContain("Uso:");
  });

  it("si no puede leer el export, lo dice sin seguir", () => {
    const { deps, errors, written } = fakeDeps(new Error("ENOENT"));
    expect(runRoster(["--in", "exp", "--out", "csv"], deps)).toBe(1);
    expect(errors[0]).toContain("No se pudo leer customers.json");
    expect(written.size).toBe(0);
  });
});

describe("runRoster con el disco de verdad", () => {
  it("lee y escribe en directorios reales", async () => {
    const { mkdtempSync, writeFileSync, readFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { REAL_ROSTER_DEPS } = await import("./roster-cli.js");
    const dir = mkdtempSync(join(tmpdir(), "roster-"));
    writeFileSync(join(dir, "customers.json"), ONE);

    expect(runRoster(["--in", dir, "--out", join(dir, "csv")], REAL_ROSTER_DEPS)).toBe(0);
    expect(readFileSync(join(dir, "csv", "customers.csv"), "utf8")).toContain("a,Ana,");
    expect(runRoster([], REAL_ROSTER_DEPS)).toBe(2);
    // El directorio temporal no se deja atrás.
    const { rmSync } = await import("node:fs");
    rmSync(dir, { recursive: true, force: true });
  });
});
