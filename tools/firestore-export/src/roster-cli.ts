import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { toRoster } from "./to-roster.js";
import type { CustomerDoc } from "./to-roster.js";

/**
 * `pnpm to-roster -- --in <dir con customers.json> --out <dir>`: arma los 4 CSV
 * de `pnpm load:roster` y `report.json`. La consola y el reporte muestran
 * solo CUENTAS, nunca un nombre, un teléfono ni una deuda.
 */
export interface RosterCliDeps {
  readFile(file: string): string;
  mkdir(dir: string): void;
  writeFile(file: string, contents: string): void;
  log(message: string): void;
  error(message: string): void;
}

export const REAL_ROSTER_DEPS: RosterCliDeps = {
  readFile: (file) => readFileSync(file, "utf8"),
  mkdir: (dir) => mkdirSync(dir, { recursive: true }),
  writeFile: (file, contents) => writeFileSync(file, contents, "utf8"),
  log: (message) => console.log(message),
  error: (message) => console.error(message),
};

function valueOf(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

export function runRoster(argv: string[], deps: RosterCliDeps = REAL_ROSTER_DEPS): number {
  const inDir = valueOf(argv, "--in");
  const outDir = valueOf(argv, "--out");
  if (inDir === undefined || outDir === undefined) {
    deps.error("Uso: pnpm to-roster -- --in <dir con customers.json> --out <dir de salida>");
    return 2;
  }
  let docs: CustomerDoc[];
  try {
    docs = JSON.parse(deps.readFile(join(inDir, "customers.json"))) as CustomerDoc[];
  } catch (error) {
    deps.error(
      `No se pudo leer customers.json: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }

  const { files, report } = toRoster(docs);
  deps.mkdir(outDir);
  for (const [name, contents] of Object.entries(files))
    deps.writeFile(join(outDir, name), contents);
  deps.writeFile(join(outDir, "report.json"), JSON.stringify(report, null, 2));

  deps.log(`Leídos ${report.read}; entran ${report.loaded}.`);
  for (const [reason, total] of Object.entries(report.discarded))
    deps.log(`  descartados, ${reason}: ${total}`);
  for (const [reason, total] of Object.entries(report.warnings))
    deps.log(`  aviso, ${reason}: ${total}`);
  return 0;
}

const isEntryPoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) process.exitCode = runRoster(process.argv.slice(2));
