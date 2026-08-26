import "reflect-metadata";
import { posix as posixPath, win32 as win32Path } from "node:path";
import { fileURLToPath } from "node:url";
import { NestFactory } from "@nestjs/core";
import { Prisma } from "@prisma/client";
import { formatSummary } from "../modules/roster-loader/format-summary.js";
import type { RunRosterLoaderOptions } from "../modules/roster-loader/roster-loader.service.js";

// Run from apps/api. `pnpm --dir`/`pnpm exec --dir` is pnpm's OWN option
// (picks the package to run in) and swallows a `--dir` that comes before
// the script name, so the CLI's own directory flag is named `--input`
// instead to never collide with it. `--dir` still works as an alias for
// anyone who already has it in a script.
const USAGE = [
  "Uso: pnpm load:roster --input <ruta> --cutover-date <AAAA-MM-DD> [--commit] [--user <username>]",
  "",
  "  --input <ruta>            Carpeta con los 4 CSV (obligatorio). Alias: --dir.",
  "  --cutover-date <fecha>    Fecha de corte, AAAA-MM-DD (obligatorio).",
  "  --commit                  Escribe de verdad. Sin esta bandera es un dry-run.",
  "  --user <username>         Usuario del sistema que queda como autor de lo",
  '                            cargado (default: "admin").',
].join("\n");

export class CliUsageError extends Error {}

/**
 * `PrismaClientInitializationError.message` can carry the raw connection
 * string — including the DB user and password — depending on which of
 * Prisma's own error paths produced it. Never print it as-is
 * (`never-print-secrets`); a fixed, actionable message is strictly more
 * useful to the operator than a stack trace anyway. Any other error keeps
 * printing just `.message`, same as everywhere else in this file.
 */
function describeBootstrapFailure(error: unknown): string {
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return "No se pudo conectar con la base de datos. Revisá que esté levantada y que DATABASE_URL/DIRECT_URL sean correctas.";
  }
  return error instanceof Error ? error.message : String(error);
}

export function parseArgs(argv: string[]): RunRosterLoaderOptions {
  if (argv.length === 0) throw new CliUsageError("No se recibió ningún argumento.");

  let dir: string | undefined;
  let cutoverDate: string | undefined;
  let commit = false;
  let loaderUsername: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--input" || flag === "--dir") {
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

  if (dir === undefined) throw new CliUsageError("Falta --input");
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

  // Dynamic imports, deliberately deferred until AFTER parseArgs succeeds:
  // AppModule pulls in ConfigModule.forRoot's env validation and the whole
  // Nest dependency graph, so importing it statically at the top of the
  // file (ESM hoists static imports before any code runs) meant a typo'd
  // flag produced a Nest bootstrap stack trace instead of the usage
  // message above, and opened DB connections for nothing.
  const { AppModule } = await import("../app.module.js");
  const { RosterLoaderService } = await import("../modules/roster-loader/roster-loader.service.js");

  let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>;
  try {
    // `logger: false`: Nest's own bootstrap logging (module init lines) is
    // pure noise for a CLI whose ENTIRE printed output must be the
    // aggregate summary below — never a stray log line, and never anything
    // that could carry a name, phone, address or amount by accident.
    //
    // `abortOnError: false`: by default NestFactory reacts to a bootstrap
    // failure (e.g. PrismaService.onModuleInit can't reach the DB) by
    // logging it and calling `process.exit()` itself — with `logger: false`
    // that log is swallowed, so the process just died with no output at
    // all, code 1, having printed nothing an operator could act on. Turning
    // this off makes NestFactory throw instead, so the catch below runs.
    app = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
      abortOnError: false,
    });
  } catch (error) {
    console.error(describeBootstrapFailure(error));
    process.exitCode = 1;
    return;
  }

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

/**
 * True when `thisFile` (this module's own path) and `invokedPath`
 * (`process.argv[1]`) name the same file — i.e. this module is the actual
 * process entrypoint (`tsx src/cli/load-roster.ts`), as opposed to being
 * imported by a test that wants `main()` without the auto-run below.
 *
 * Comparing `import.meta.url` against `pathToFileURL(process.argv[1]).href`
 * as raw strings (the pattern `src/main.ts` uses) is what production code
 * elsewhere in this repo relies on, but on the Windows machine that runs
 * the real roster load it came back false even for a plain, unambiguous
 * invocation: `main()` was silently never called and the process exited 0
 * having done nothing. Node/tsx are not guaranteed to agree on drive-letter
 * casing between the URL form and the raw argv path, and Windows paths are
 * case-insensitive anyway, so comparing as filesystem paths — case-folded
 * on win32 only — is both correct there and a no-op everywhere else, since
 * two POSIX paths that only differ by case are never the same file.
 *
 * Takes plain paths, not URLs, and normalizes with the explicit
 * `path.win32`/`path.posix` module for the given `platform` (never the
 * ambient `node:path`, which is bound to whatever OS runs the process) so
 * the comparison itself — the only thing worth unit testing here — behaves
 * identically no matter which OS runs the test suite.
 */
export function isEntryPointMatch(
  thisFile: string,
  invokedPath: string | undefined,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (invokedPath === undefined) return false;
  const normalize = platform === "win32" ? win32Path.normalize : posixPath.normalize;
  const a = normalize(thisFile);
  const b = normalize(invokedPath);
  return platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

const isEntryPoint = isEntryPointMatch(fileURLToPath(import.meta.url), process.argv[1]);
if (isEntryPoint) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    // main() itself never rejects (see its own doc comment) — reaching here
    // means something outside its control blew up (e.g. Nest's own
    // bootstrap). Still never a stack trace: only the message.
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
