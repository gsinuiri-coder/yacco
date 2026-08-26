import "reflect-metadata";
import { pathToFileURL } from "node:url";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module.js";
import { formatSummary } from "../modules/roster-loader/format-summary.js";
import { RosterLoaderService } from "../modules/roster-loader/roster-loader.service.js";
import type { RunRosterLoaderOptions } from "../modules/roster-loader/roster-loader.service.js";

const USAGE = [
  "Uso: pnpm load:roster -- --dir <ruta> --cutover-date <AAAA-MM-DD> [--commit] [--user <username>]",
  "",
  "  --dir <ruta>             Carpeta con los 4 CSV (obligatorio).",
  "  --cutover-date <fecha>   Fecha de corte, AAAA-MM-DD (obligatorio).",
  "  --commit                 Escribe de verdad. Sin esta bandera es un dry-run.",
  "  --user <username>        Usuario del sistema que queda como autor de lo",
  '                           cargado (default: "admin").',
].join("\n");

class CliUsageError extends Error {}

function parseArgs(argv: string[]): RunRosterLoaderOptions {
  let dir: string | undefined;
  let cutoverDate: string | undefined;
  let commit = false;
  let loaderUsername: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--dir") {
      dir = argv[index + 1];
      index += 1;
    } else if (flag === "--cutover-date") {
      cutoverDate = argv[index + 1];
      index += 1;
    } else if (flag === "--commit") {
      commit = true;
    } else if (flag === "--user") {
      loaderUsername = argv[index + 1];
      index += 1;
    } else {
      throw new CliUsageError(`Opción desconocida: "${flag}"`);
    }
  }

  if (dir === undefined) throw new CliUsageError("Falta --dir");
  if (cutoverDate === undefined) throw new CliUsageError("Falta --cutover-date");

  return { dir, cutoverDate, commit, ...(loaderUsername !== undefined ? { loaderUsername } : {}) };
}

/**
 * The whole CLI, self-contained: argument parsing, running the loader, and
 * reporting — success or failure — never throws back to its caller. Kept
 * this way (rather than only handling errors in the entrypoint block below)
 * so an integration test can call `main()` directly and assert on
 * `console.log`/`console.error`/`process.exitCode`, the same way
 * `bootstrap.int.test.ts` exercises `src/main.ts`'s `bootstrap()`.
 */
export async function main(argv: string[]): Promise<void> {
  let options: RunRosterLoaderOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    if (error instanceof CliUsageError) {
      console.error(`${error.message}\n\n${USAGE}`);
    } else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exitCode = 1;
    return;
  }

  // `logger: false`: Nest's own bootstrap logging (module init lines) is
  // pure noise for a CLI whose ENTIRE printed output must be the aggregate
  // summary below — never a stray log line, and never anything that could
  // carry a name, phone, address or amount by accident.
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const loader = app.get(RosterLoaderService);
    const result = await loader.run(options);

    if (!result.ok) {
      console.error("La carga del padrón encontró errores. No se escribió nada.\n");
      for (const issue of result.issues) {
        console.error(`  [${issue.file}:${issue.line}] ${issue.message}`);
      }
      process.exitCode = 1;
      return;
    }

    for (const line of formatSummary(result.summary)) {
      console.log(line);
    }
  } finally {
    await app.close();
  }
}

const isEntryPoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    // main() itself never rejects (see its own doc comment) — reaching here
    // means something outside its control blew up (e.g. Nest's own
    // bootstrap). Still never a stack trace: only the message.
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
