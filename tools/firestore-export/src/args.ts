export type Command = "customers" | "vouchers";

export interface CliArgs {
  command: Command;
  /** vouchers only; ignored for customers. */
  pendingOnly: boolean;
  outDir: string;
}

export const DEFAULT_OUT_DIR = "output";

const USAGE = [
  "Uso:",
  "  pnpm export:customers            -> output/customers.json",
  "  pnpm export:vouchers             -> output/vouchers.json (solo con deuda pendiente)",
  "  pnpm export:vouchers -- --all    -> todos los vouchers",
  "  pnpm export:vouchers -- --pending-only",
  "  ... -- --out <directorio>        -> otro directorio de salida",
].join("\n");

export class UsageError extends Error {
  constructor(message: string) {
    super(`${message}\n\n${USAGE}`);
    this.name = "UsageError";
  }
}

/** Parses `process.argv.slice(2)`. Pure, so it is tested without running anything. */
export function parseArgs(argv: string[]): CliArgs {
  const [command, ...rest] = argv;
  if (command !== "customers" && command !== "vouchers") {
    throw new UsageError(`Comando desconocido: "${command ?? ""}"`);
  }

  let pendingOnly = true;
  let outDir = DEFAULT_OUT_DIR;
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (flag === "--all") {
      pendingOnly = false;
    } else if (flag === "--pending-only") {
      pendingOnly = true;
    } else if (flag === "--out") {
      const value = rest[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new UsageError("--out necesita un directorio");
      }
      outDir = value;
      index += 1;
    } else {
      throw new UsageError(`Opción desconocida: "${flag}"`);
    }
  }
  return { command, pendingOnly, outDir };
}
