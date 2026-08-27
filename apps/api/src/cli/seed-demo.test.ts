import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Unlike load-roster.test.ts, this doesn't need the compiled artifact to
 * prove DI resolves — seed-demo.ts has no Nest dependency injection, it's a
 * plain HTTP client. It still runs the COMPILED file (matching what `pnpm
 * demo:data` actually runs, per package.json) so a build-time regression
 * (e.g. a stray TS-only construct) would show up here the same way it would
 * for any real invocation.
 */
describe("seed-demo CLI subprocess (compiled)", () => {
  const projectRoot = path.join(__dirname, "..", "..");
  const compiledScriptPath = path.join(projectRoot, "dist", "cli", "seed-demo.js");

  beforeAll(() => {
    if (!existsSync(compiledScriptPath)) {
      throw new Error(
        `No existe ${compiledScriptPath}. Corré \`pnpm build\` antes de los tests ` +
          "(mismo motivo que load-roster.test.ts).",
      );
    }
  });

  test("unreachable API: fails with a clear, actionable message, not a raw stack trace", () => {
    // A loopback port nothing listens on: connection-refused, not a hang.
    const result = spawnSync(process.execPath, [compiledScriptPath], {
      cwd: projectRoot,
      encoding: "utf8",
      timeout: 15000,
      env: {
        ...process.env,
        DEMO_API_BASE_URL: "http://127.0.0.1:1/api/v1",
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("No se pudo conectar con la API en http://127.0.0.1:1/api/v1");
    expect(result.stderr).toContain("pnpm demo:up && pnpm dev:api");
  });

  test("never leaks the admin password it read from the environment", () => {
    const SECRET_PASSWORD = "s3cr3t-admin-pw-nobody-should-see";
    const result = spawnSync(process.execPath, [compiledScriptPath], {
      cwd: projectRoot,
      encoding: "utf8",
      timeout: 15000,
      env: {
        ...process.env,
        DEMO_API_BASE_URL: "http://127.0.0.1:1/api/v1",
        DEMO_ADMIN_PASSWORD: SECRET_PASSWORD,
      },
    });

    expect(result.stdout).not.toContain(SECRET_PASSWORD);
    expect(result.stderr).not.toContain(SECRET_PASSWORD);
  });
});
