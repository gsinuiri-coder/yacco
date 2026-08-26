import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CliUsageError, isEntryPointMatch, parseArgs } from "./load-roster.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("parseArgs", () => {
  test("parses --input, --cutover-date, --commit and --user", () => {
    const options = parseArgs([
      "--input",
      "/csv",
      "--cutover-date",
      "2026-08-25",
      "--commit",
      "--user",
      "giancarlo",
    ]);

    expect(options).toEqual({
      dir: "/csv",
      cutoverDate: "2026-08-25",
      commit: true,
      loaderUsername: "giancarlo",
    });
  });

  test("dry-run by default (no --commit) and no --user", () => {
    const options = parseArgs(["--input", "/csv", "--cutover-date", "2026-08-25"]);

    expect(options).toEqual({ dir: "/csv", cutoverDate: "2026-08-25", commit: false });
  });

  test("--dir is still accepted as an alias for --input", () => {
    const options = parseArgs(["--dir", "/csv", "--cutover-date", "2026-08-25"]);

    expect(options.dir).toBe("/csv");
  });

  test("no arguments at all throws CliUsageError, not a generic 'missing --input'", () => {
    expect(() => parseArgs([])).toThrow(CliUsageError);
    expect(() => parseArgs([])).toThrow("No se recibió ningún argumento.");
  });

  test("missing --input throws CliUsageError", () => {
    expect(() => parseArgs(["--cutover-date", "2026-08-25"])).toThrow(CliUsageError);
    expect(() => parseArgs(["--cutover-date", "2026-08-25"])).toThrow("Falta --input");
  });

  test("missing --cutover-date throws CliUsageError", () => {
    expect(() => parseArgs(["--input", "/csv"])).toThrow(CliUsageError);
    expect(() => parseArgs(["--input", "/csv"])).toThrow("Falta --cutover-date");
  });

  test("unknown flag throws CliUsageError naming the flag", () => {
    expect(() => parseArgs(["--input", "/csv", "--cutover-date", "2026-08-25", "--bogus"])).toThrow(
      'Opción desconocida: "--bogus"',
    );
  });
});

describe("isEntryPointMatch", () => {
  test("win32: matches despite different drive-letter/path casing", () => {
    expect(
      isEntryPointMatch(
        "C:\\repo\\apps\\api\\src\\cli\\load-roster.ts",
        "c:\\repo\\apps\\api\\src\\cli\\LOAD-ROSTER.ts",
        "win32",
      ),
    ).toBe(true);
  });

  test("win32: does not match a different file", () => {
    expect(
      isEntryPointMatch(
        "C:\\repo\\apps\\api\\src\\cli\\load-roster.ts",
        "C:\\repo\\apps\\api\\src\\main.ts",
        "win32",
      ),
    ).toBe(false);
  });

  test("win32: normalizes forward slashes from a POSIX-style argv", () => {
    expect(
      isEntryPointMatch(
        "C:\\repo\\apps\\api\\src\\cli\\load-roster.ts",
        "C:/repo/apps/api/src/cli/load-roster.ts",
        "win32",
      ),
    ).toBe(true);
  });

  test("posix: matches the same path", () => {
    expect(
      isEntryPointMatch(
        "/home/user/repo/apps/api/src/cli/load-roster.ts",
        "/home/user/repo/apps/api/src/cli/load-roster.ts",
        "linux",
      ),
    ).toBe(true);
  });

  test("posix: a path differing only by case is a different file, not a match", () => {
    expect(
      isEntryPointMatch(
        "/home/user/repo/apps/api/src/cli/load-roster.ts",
        "/home/user/repo/apps/api/src/cli/LOAD-ROSTER.ts",
        "linux",
      ),
    ).toBe(false);
  });

  test("no argv[1] (e.g. this module was imported, not run) never matches", () => {
    expect(
      isEntryPointMatch("C:\\repo\\apps\\api\\src\\cli\\load-roster.ts", undefined, "win32"),
    ).toBe(false);
  });
});

/**
 * `tsx` (esbuild) never emits `design:paramtypes` for `emitDecoratorMetadata`,
 * so under it Nest's constructor injection hands every provider `undefined`
 * instead of its dependencies — this CLI could never actually run under
 * `tsx`, on any platform. These tests exercise the COMPILED artifact
 * (`dist/cli/load-roster.js`, built by `tsc`, exactly what `pnpm load:roster`
 * and production both run — see package.json) instead of `tsx` on the
 * TypeScript source, because that's the only way to prove DI really
 * resolves. That means these tests need `dist/` to already exist and be
 * current: CI's "Build" step runs before "Unit tests" for exactly this
 * reason (see .github/workflows/ci.yml) — running `pnpm test` locally
 * without a prior `pnpm build` fails the precondition check below instead
 * of a confusing ENOENT.
 */
describe("CLI subprocess (compiled)", () => {
  const projectRoot = path.join(__dirname, "..", "..");
  const compiledScriptPath = path.join(projectRoot, "dist", "cli", "load-roster.js");

  beforeAll(() => {
    if (!existsSync(compiledScriptPath)) {
      throw new Error(
        `No existe ${compiledScriptPath}. Estos tests corren el CLI compilado ` +
          "(la única forma de probar que la inyección de dependencias de Nest " +
          "funciona bajo tsc, no bajo tsx) — corré `pnpm build` antes de los tests.",
      );
    }
  });

  test("running the compiled file with no arguments prints usage and exits 1", () => {
    const result = spawnSync(process.execPath, [compiledScriptPath], {
      cwd: projectRoot,
      encoding: "utf8",
      timeout: 30000,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("No se recibió ningún argumento.");
    expect(result.stderr).toContain("Uso: pnpm load:roster --input <ruta>");
  });

  test("valid arguments, unreachable database: DI resolves (Nest actually boots) and the raw connection string never leaks", () => {
    // A loopback port nothing listens on: connection-refused, not a hang.
    const DEAD_PASSWORD = "s3cr3t-pw-nobody-should-see";
    const deadDatabaseUrl = `postgresql://roster_user:${DEAD_PASSWORD}@127.0.0.1:1/roster_test`;

    const result = spawnSync(
      process.execPath,
      [
        compiledScriptPath,
        "--input",
        path.join(projectRoot, "test", "fixtures", "roster"),
        "--cutover-date",
        "2026-08-25",
      ],
      {
        cwd: projectRoot,
        encoding: "utf8",
        timeout: 30000,
        env: {
          ...process.env,
          DATABASE_URL: deadDatabaseUrl,
          DIRECT_URL: deadDatabaseUrl,
          JWT_ACCESS_SECRET: "test-access-secret",
          JWT_ACCESS_EXPIRES_IN: "15m",
          JWT_REFRESH_SECRET: "test-refresh-secret",
          JWT_REFRESH_EXPIRES_IN: "30d",
          PORT: "0",
        },
      },
    );

    // The specific safe message, not just "some non-empty stderr": a DI
    // crash (undefined dependency) ALSO produces non-empty stderr without
    // the password, so a looser assertion here would pass even if DI were
    // broken — which is exactly how the previous tsx-based version of
    // this test missed the `emitDecoratorMetadata` bug in the first place.
    expect(result.stderr).toContain(
      "No se pudo conectar con la base de datos. Revisá que esté levantada",
    );
    expect(result.stderr).not.toContain("getOrThrow");
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain(DEAD_PASSWORD);
    expect(result.stderr).not.toContain(DEAD_PASSWORD);
    expect(result.stdout).not.toContain(deadDatabaseUrl);
    expect(result.stderr).not.toContain(deadDatabaseUrl);
  }, 30000);
});
