import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { jest } from "@jest/globals";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { RosterLoaderService } from "../../src/modules/roster-loader/roster-loader.service.js";
import type { RunRosterLoaderResult } from "../../src/modules/roster-loader/roster-loader.service.js";
import type { LoadSummary } from "../../src/modules/roster-loader/roster-loader.types.js";
import { startTestApp, stopTestApp } from "./support/test-app.js";
import type { TestAppContext } from "./support/test-app.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "../fixtures/roster");
const CUTOVER_DATE = "2026-08-25";

let ctx: TestAppContext;
let prisma: PrismaService;
let loader: RosterLoaderService;
let tempDirs: string[] = [];

beforeAll(async () => {
  ctx = await startTestApp();
  prisma = ctx.app.get(PrismaService);
  loader = ctx.app.get(RosterLoaderService);
}, 180000);

afterAll(async () => {
  await stopTestApp(ctx);
});

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

/** A throwaway directory with hand-written CSVs, cleaned up after the test. */
function writeFixtureSet(files: {
  customers: string;
  locations: string;
  containers: string;
  money: string;
}): string {
  const dir = mkdtempSync(path.join(tmpdir(), "roster-loader-"));
  tempDirs.push(dir);
  writeFileSync(path.join(dir, "customers.csv"), files.customers);
  writeFileSync(path.join(dir, "locations.csv"), files.locations);
  writeFileSync(path.join(dir, "opening_containers.csv"), files.containers);
  writeFileSync(path.join(dir, "opening_money.csv"), files.money);
  return dir;
}

function expectOk(
  result: RunRosterLoaderResult,
): asserts result is { ok: true; summary: LoadSummary } {
  if (!result.ok) {
    throw new Error(`expected ok:true, got issues: ${JSON.stringify(result.issues)}`);
  }
}

async function countAll() {
  const [customers, locations, movements, counts, sales, payments] = await Promise.all([
    prisma.customer.count(),
    prisma.customerLocation.count(),
    prisma.containerMovement.count({ where: { type: "OPENING_BALANCE" } }),
    prisma.containerCount.count(),
    prisma.sale.count({ where: { isOpeningBalance: true } }),
    prisma.payment.count({ where: { isOpeningBalance: true } }),
  ]);
  return { customers, locations, movements, counts, sales, payments };
}

describe("RosterLoaderService — carga feliz completa (fixtures reales)", () => {
  test("dry-run reporta agregados y no escribe nada", async () => {
    const before = await countAll();

    const result = await loader.run({
      dir: FIXTURES_DIR,
      cutoverDate: CUTOVER_DATE,
      commit: false,
    });

    expectOk(result);
    expect(result.summary.committed).toBe(false);
    expect(result.summary.customers.total).toBe(8);
    expect(result.summary.customers.active).toBe(7);
    expect(result.summary.customers.inactive).toBe(1);
    expect(result.summary.locations.total).toBe(9);
    expect(await countAll()).toEqual(before);
  });

  test("--commit escribe clientes, ubicaciones, movimientos de apertura, conteos confirmatorios y dinero", async () => {
    const result = await loader.run({ dir: FIXTURES_DIR, cutoverDate: CUTOVER_DATE, commit: true });

    expectOk(result);
    expect(result.summary.committed).toBe(true);
    expect(result.summary.customers).toEqual({ total: 8, active: 7, inactive: 1 });
    expect(result.summary.locations.total).toBe(9);
    // 8 rows, EJ-002-B has no qty_no_spout (0) -> 6 "con caño" rows with qty>0 +
    // one extra "sin caño" row (EJ-002-A, EJ-008-A) => matches the fixture by count, not by name.
    expect(result.summary.containerMovements.created).toBeGreaterThan(0);
    expect(result.summary.containerMovements.alreadyLoaded).toBe(0);
    expect(result.summary.containerTotalsByType.get("Con caño")).toBe(
      2 + 6 + 4 + 1 + 2 + 5 + 3 + 8 + 2,
    );
    expect(result.summary.containerTotalsByType.get("Sin caño")).toBe(2 + 3 + 3);
    // EJ-005-A and EJ-006-A are ESTIMATED with qty>0 -> pending.
    expect(result.summary.pendingToCount).toBe(2);
    expect(result.summary.confirmatoryCounts.alreadyLoaded).toBe(0);
    // Charges (amount > 0): EJ-001, EJ-002, EJ-004, EJ-005, EJ-008. EJ-006 and
    // EJ-007 are 0.00 ("no genera nada"), skipped rather than counted.
    expect(result.summary.openingCharges.created).toBe(5);
    expect(result.summary.openingCredits.created).toBe(1); // EJ-003, saldo a favor
    expect(result.summary.netDebtTotal).toBe((45 + 180 - 60 + 15 + 240 + 0 + 0 + 30).toFixed(2));
  });
});

describe("RosterLoaderService — casos de dominio de los fixtures reales", () => {
  beforeAll(async () => {
    // Shared commit for the assertions below: idempotent, so running it
    // again here (after the describe block above already committed once)
    // is safe and leaves the same state.
    const result = await loader.run({ dir: FIXTURES_DIR, cutoverDate: CUTOVER_DATE, commit: true });
    expectOk(result);
  });

  test("cliente inactivo (EJ-005) queda inactivo pero con su deuda y sus envases cargados", async () => {
    const customer = await prisma.customer.findUniqueOrThrow({
      where: { externalCode: "EJ-005" },
      include: { locations: true },
    });

    expect(customer.active).toBe(false);
    expect(customer.debtBalance.toFixed(2)).toBe("240.00");

    const location = customer.locations.find((loc) => loc.externalCode === "EJ-005-A");
    expect(location).toBeDefined();
    const balances = await prisma.customerContainerBalance.findMany({
      where: { locationId: location?.id },
      include: { containerType: true },
    });
    const total = balances.reduce((sum, balance) => sum + balance.quantity, 0);
    expect(total).toBe(5 + 3);
  });

  test("cliente con saldo a favor (EJ-003) queda con debtBalance negativo", async () => {
    const customer = await prisma.customer.findUniqueOrThrow({ where: { externalCode: "EJ-003" } });
    expect(customer.debtBalance.toFixed(2)).toBe("-60.00");
    expect(customer.active).toBe(true);
  });

  test("cliente con dos ubicaciones (EJ-002): la deuda vive en el cliente, los envases en cada ubicación", async () => {
    const customer = await prisma.customer.findUniqueOrThrow({
      where: { externalCode: "EJ-002" },
      include: { locations: true },
    });
    expect(customer.debtBalance.toFixed(2)).toBe("180.00");
    expect(customer.locations).toHaveLength(2);

    const bodega = customer.locations.find((loc) => loc.externalCode === "EJ-002-A");
    const deposito = customer.locations.find((loc) => loc.externalCode === "EJ-002-B");
    expect(bodega?.isPrimary).toBe(true);
    expect(deposito?.isPrimary).toBe(false);

    const bodegaBalances = await prisma.customerContainerBalance.findMany({
      where: { locationId: bodega?.id },
    });
    const depositoBalances = await prisma.customerContainerBalance.findMany({
      where: { locationId: deposito?.id },
    });
    expect(bodegaBalances.reduce((sum, b) => sum + b.quantity, 0)).toBe(6 + 2);
    expect(depositoBalances.reduce((sum, b) => sum + b.quantity, 0)).toBe(4);
  });

  test("dirección vacía (EJ-004) no rompe la carga: se guarda como texto vacío, con la referencia del mapa", async () => {
    const location = await prisma.customerLocation.findUniqueOrThrow({
      where: { externalCode: "EJ-004-A" },
    });
    expect(location.address).toBe("");
    expect(location.addressReference).toBe("https://maps.app.goo.gl/EJEMPLONOREAL");
  });

  test("locations.csv no tiene columna de teléfono: cada ubicación hereda el teléfono del cliente", async () => {
    const customer = await prisma.customer.findUniqueOrThrow({
      where: { externalCode: "EJ-002" },
      include: { locations: true },
    });
    for (const location of customer.locations) {
      expect(location.phone).toBe("912345678");
    }
  });

  test("confianza HIGH deja un conteo confirmatorio que coincide, sin ajuste; ESTIMATED no deja conteo", async () => {
    const high = await prisma.customerLocation.findUniqueOrThrow({
      where: { externalCode: "EJ-001-A" },
    });
    const highCounts = await prisma.containerCount.findMany({ where: { locationId: high.id } });
    expect(highCounts).toHaveLength(1);
    expect(highCounts[0]?.countedQuantity).toBe(highCounts[0]?.expectedQuantity);
    expect(highCounts[0]?.adjustmentId).toBeNull();

    const estimated = await prisma.customerLocation.findUniqueOrThrow({
      where: { externalCode: "EJ-005-A" },
    });
    const estimatedCounts = await prisma.containerCount.findMany({
      where: { locationId: estimated.id },
    });
    expect(estimatedCounts).toHaveLength(0);
  });

  test("los movimientos de apertura quedan fechados en el corte, no en el instante de la carga", async () => {
    const location = await prisma.customerLocation.findUniqueOrThrow({
      where: { externalCode: "EJ-001-A" },
    });
    const movement = await prisma.containerMovement.findFirstOrThrow({
      where: { locationId: location.id, type: "OPENING_BALANCE" },
    });
    expect(movement.occurredAt.toISOString()).toBe("2026-08-25T05:00:00.000Z");
  });
});

describe("RosterLoaderService — idempotencia", () => {
  test("correr la carga dos veces seguidas deja los mismos conteos, sin duplicar", async () => {
    const first = await loader.run({ dir: FIXTURES_DIR, cutoverDate: CUTOVER_DATE, commit: true });
    expectOk(first);
    const afterFirst = await countAll();

    const second = await loader.run({ dir: FIXTURES_DIR, cutoverDate: CUTOVER_DATE, commit: true });
    expectOk(second);
    const afterSecond = await countAll();

    expect(afterSecond).toEqual(afterFirst);
    expect(second.summary.containerMovements.created).toBe(0);
    expect(second.summary.containerMovements.alreadyLoaded).toBeGreaterThan(0);
    expect(second.summary.confirmatoryCounts.created).toBe(0);
    expect(second.summary.openingCharges.created).toBe(0);
    expect(second.summary.openingCredits.created).toBe(0);
    expect(second.summary.openingCharges.alreadyLoaded).toBeGreaterThan(0);
    expect(second.summary.openingCredits.alreadyLoaded).toBeGreaterThan(0);
  });

  test("una segunda dry-run refleja lo ya cargado (alreadyLoaded), no lo vuelve a contar como created", async () => {
    const dryRun = await loader.run({
      dir: FIXTURES_DIR,
      cutoverDate: CUTOVER_DATE,
      commit: false,
    });
    expectOk(dryRun);
    expect(dryRun.summary.containerMovements.created).toBe(0);
    expect(dryRun.summary.containerMovements.alreadyLoaded).toBeGreaterThan(0);
  });
});

describe("RosterLoaderService — errores: nada se escribe si hay al menos uno", () => {
  test("un external_code duplicado en customers.csv aborta toda la carga, sin escribir nada", async () => {
    const dir = writeFixtureSet({
      customers:
        "external_code,name,phone,zone,status,notes\n" +
        "ERR-1,Uno,900000001,,ACTIVE,\n" +
        "ERR-1,Otro,900000002,,ACTIVE,\n",
      locations:
        "location_code,customer_code,label,address,zone,maps_url,is_primary\n" +
        "ERR-1-A,ERR-1,Casa,Calle 1,,,SI\n",
      containers: "location_code,qty_spout,qty_no_spout,confidence,notes\nERR-1-A,1,0,HIGH,\n",
      money: "customer_code,amount,notes\nERR-1,10.00,\n",
    });
    const before = await countAll();

    const result = await loader.run({ dir, cutoverDate: CUTOVER_DATE, commit: true });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues[0]).toMatchObject({ file: "customers.csv" });
      // Identified by file and line, never by name.
      for (const issue of result.issues) {
        expect(issue.message).not.toContain("Uno");
        expect(issue.message).not.toContain("Otro");
      }
    }
    expect(await countAll()).toEqual(before);
    await expect(
      prisma.customer.findUnique({ where: { externalCode: "ERR-1" } }),
    ).resolves.toBeNull();
  });

  test("un error tardío (customer_code huérfano en opening_money.csv) también deja todo sin escribir", async () => {
    const dir = writeFixtureSet({
      customers: "external_code,name,phone,zone,status,notes\nERR-2,Uno,900000003,,ACTIVE,\n",
      locations:
        "location_code,customer_code,label,address,zone,maps_url,is_primary\n" +
        "ERR-2-A,ERR-2,Casa,Calle 2,,,SI\n",
      containers: "location_code,qty_spout,qty_no_spout,confidence,notes\nERR-2-A,1,0,HIGH,\n",
      money: "customer_code,amount,notes\nNOPE,10.00,\n",
    });
    const before = await countAll();

    const result = await loader.run({ dir, cutoverDate: CUTOVER_DATE, commit: true });

    expect(result.ok).toBe(false);
    expect(await countAll()).toEqual(before);
    await expect(
      prisma.customer.findUnique({ where: { externalCode: "ERR-2" } }),
    ).resolves.toBeNull();
  });

  test("--dir apuntando a una carpeta inexistente reporta un error de configuración, sin escribir nada", async () => {
    const before = await countAll();

    const result = await loader.run({
      dir: path.join(tmpdir(), "no-existe-jamas-roster"),
      cutoverDate: CUTOVER_DATE,
      commit: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.file).toBe("(config)");
    }
    expect(await countAll()).toEqual(before);
  });

  test("un usuario cargador inexistente (--user) reporta un error de configuración, sin escribir nada", async () => {
    const dir = writeFixtureSet({
      customers: "external_code,name,phone,zone,status,notes\nERR-3,Uno,900000004,,ACTIVE,\n",
      locations:
        "location_code,customer_code,label,address,zone,maps_url,is_primary\n" +
        "ERR-3-A,ERR-3,Casa,Calle 3,,,SI\n",
      containers: "location_code,qty_spout,qty_no_spout,confidence,notes\nERR-3-A,1,0,HIGH,\n",
      money: "customer_code,amount,notes\n",
    });
    const before = await countAll();

    const result = await loader.run({
      dir,
      cutoverDate: CUTOVER_DATE,
      commit: true,
      loaderUsername: "no-existe-este-usuario",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.message.includes("no-existe-este-usuario"))).toBe(
        true,
      );
    }
    expect(await countAll()).toEqual(before);
  });
});

// Exercises the real CLI entrypoint (src/cli/load-roster.ts) directly, the
// same way bootstrap.int.test.ts exercises src/main.ts — proves argv
// parsing and the NestFactory.createApplicationContext wiring actually
// work, not just RosterLoaderService.run() called in-process above. Reuses
// the Testcontainers Postgres already started for `ctx` via the env vars
// startTestApp() set; main() opens its own, separate application context
// against that same database and closes it in its `finally`.
describe("CLI: load-roster main()", () => {
  let logSpy: jest.SpiedFunction<typeof console.log>;
  let errorSpy: jest.SpiedFunction<typeof console.error>;
  let originalExitCode: number | string | undefined;

  beforeEach(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    process.exitCode = originalExitCode;
  });

  test("dry-run: prints the summary and never touches exitCode", async () => {
    const { main } = await import("../../src/cli/load-roster.js");

    await main(["--input", FIXTURES_DIR, "--cutover-date", CUTOVER_DATE]);

    const printed = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(printed).toMatch(/DRY-RUN/);
    expect(process.exitCode).toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  // `--dir` predates `--input` (see load-roster.test.ts's parseArgs suite for
  // why it was renamed) and is kept only as a backward-compatible alias —
  // nothing else here exercises it, so a regression would go unnoticed.
  test("--dir sigue funcionando como alias de --input", async () => {
    const { main } = await import("../../src/cli/load-roster.js");

    await main(["--dir", FIXTURES_DIR, "--cutover-date", CUTOVER_DATE]);

    const printed = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(printed).toMatch(/DRY-RUN/);
    expect(process.exitCode).toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test("missing --input: prints usage to stderr and sets exitCode 1", async () => {
    const { main } = await import("../../src/cli/load-roster.js");

    await main(["--cutover-date", CUTOVER_DATE]);

    expect(process.exitCode).toBe(1);
    const printed = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(printed).toMatch(/Falta --input/);
  });

  test("errores de validación: se listan por archivo y línea en stderr, exitCode 1, nada escrito", async () => {
    const dir = writeFixtureSet({
      customers:
        "external_code,name,phone,zone,status,notes\nCLI-1,Uno,1,,ACTIVE,\nCLI-1,Dos,2,,ACTIVE,\n",
      locations:
        "location_code,customer_code,label,address,zone,maps_url,is_primary\nCLI-1-A,CLI-1,Casa,X,,,SI\n",
      containers: "location_code,qty_spout,qty_no_spout,confidence,notes\nCLI-1-A,1,0,HIGH,\n",
      money: "customer_code,amount,notes\n",
    });
    const before = await countAll();
    const { main } = await import("../../src/cli/load-roster.js");

    await main(["--input", dir, "--cutover-date", CUTOVER_DATE, "--commit"]);

    expect(process.exitCode).toBe(1);
    const printed = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(printed).toContain("customers.csv");
    expect(printed).not.toContain("Uno");
    expect(printed).not.toContain("Dos");
    expect(await countAll()).toEqual(before);
  });
});
