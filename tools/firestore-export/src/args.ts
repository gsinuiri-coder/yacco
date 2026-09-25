export type Command = "customers" | "tags" | "vouchers";

export interface CliArgs {
  command: Command;
  /** vouchers only; ignored for customers. */
  pendingOnly: boolean;
  outDir: string;
  /** `--project <id>`; si falta, la variable de entorno o el proyecto del sistema viejo. */
  projectId?: string;
}

export const DEFAULT_OUT_DIR = "output";

const USAGE = [
  "Uso:",
  "  pnpm export:customers            -> output/customers.json",
  "  pnpm export:tags                 -> output/tags.json (solo id y etiquetas)",
  "  pnpm export:vouchers             -> output/vouchers.json (solo con deuda pendiente)",
  "  pnpm export:vouchers -- --all    -> todos los vouchers",
  "  pnpm export:vouchers -- --pending-only",
  "  ... -- --out <directorio>        -> otro directorio de salida",
  "  ... -- --project <id>            -> otro proyecto de Firebase (por defecto yacco-2026)",
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
  if (command !== "customers" && command !== "tags" && command !== "vouchers") {
    throw new UsageError(`Comando desconocido: "${command ?? ""}"`);
  }

  let pendingOnly = true;
  let outDir = DEFAULT_OUT_DIR;
  let projectId: string | undefined;
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (flag === "--all") {
      pendingOnly = false;
    } else if (flag === "--pending-only") {
      pendingOnly = true;
    } else if (flag === "--out" || flag === "--project") {
      const value = rest[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new UsageError(
          flag === "--out"
            ? "--out necesita un directorio"
            : "--project necesita un id de proyecto",
        );
      }
      if (flag === "--out") outDir = value;
      else projectId = value;
      index += 1;
    } else {
      throw new UsageError(`Opción desconocida: "${flag}"`);
    }
  }
  return { command, pendingOnly, outDir, ...(projectId === undefined ? {} : { projectId }) };
}
