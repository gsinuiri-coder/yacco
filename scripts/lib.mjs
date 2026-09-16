/**
 * Shared plumbing for the infrastructure scripts (`pnpm env:*`, `pnpm
 * secrets:gcp`, `pnpm deploy:api`, ...).
 *
 * Two jobs, and both exist to keep credentials out of places they leak from:
 *
 * 1. `readEnvFile` is the ONLY reader of `.env.setup`. No agent and no other
 *    script opens that file directly, so there is exactly one place to audit.
 * 2. `run` launches external CLIs WITHOUT a shell, passes credentials through
 *    the child's `env` (never argv, which is world-readable in `ps` and lands
 *    in shell history), and scrubs known secret values out of everything it
 *    prints or throws.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const ENV_SETUP_PATH = join(REPO_ROOT, ".env.setup");

const IS_WINDOWS = process.platform === "win32";

/**
 * Key names whose VALUE must never be printed, matched case-insensitively.
 * `DATABASE_URL`/`DIRECT_URL` are in the list because a Postgres connection
 * string carries the role password inline — they are secrets that happen not
 * to be spelled like one.
 */
const SECRET_KEY_PATTERN = /(SECRET|PASSWORD|TOKEN|API_KEY|_KEY|DATABASE_URL|DIRECT_URL)/i;

export function isSecretKey(key) {
  return SECRET_KEY_PATTERN.test(key);
}

// Values collected here are scrubbed from every string this module prints or
// throws. Registering by VALUE rather than by key name is what makes the
// scrub survive a secret being interpolated into an unrelated message — an
// error from `gcloud` quoting the connection string back at us, say.
const knownSecrets = new Set();

export function registerSecret(value) {
  // Short values would turn `redact` into a wildcard that mangles ordinary
  // output; nothing we treat as a secret is this short.
  if (typeof value === "string" && value.trim().length >= 8) {
    knownSecrets.add(value.trim());
  }
}

export function redact(text) {
  if (typeof text !== "string" || text.length === 0) return text;
  let out = text;
  for (const secret of knownSecrets) {
    out = out.split(secret).join("***");
  }
  return out;
}

/**
 * Parses dotenv-style TEXT into a plain object. Supports `KEY=value`,
 * `export KEY=value`, `#` comments, blank lines, and single/double quoted
 * values. Every secret-looking value found is registered for redaction, so
 * merely parsing `.env.setup` protects its contents from later output.
 *
 * Takes the contents rather than a path so a caller that must also WRITE the
 * file can read it exactly once and parse what it read. Reading it a second
 * time to parse would leave a window in which the two disagree — and
 * `existsSync` followed by a write is a check-then-use race (CodeQL
 * `js/file-system-race`).
 */
export function parseEnv(contents) {
  const parsed = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (match === null) continue;

    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    } else {
      // An unquoted trailing `# comment` is not part of the value.
      value = value.replace(/\s+#.*$/, "").trim();
    }

    parsed[key] = value;
    if (isSecretKey(key)) registerSecret(value);
  }
  return parsed;
}

/**
 * Lee el archivo y devuelve su contenido, o `null` si no existe.
 *
 * Intenta abrirlo y trata el ENOENT, en vez de preguntar primero si existe:
 * un `existsSync` seguido de una lectura o una escritura es una carrera
 * check-then-use, y la respuesta del `existsSync` puede ser mentira para
 * cuando llega la segunda llamada. Una sola syscall no puede desincronizarse
 * consigo misma.
 */
export function readFileOrNull(path = ENV_SETUP_PATH) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Parsea un archivo dotenv. Un archivo inexistente no es un error: da `{}`,
 * que es lo que deja a `env:check` decir "todavía no hay nada" en vez de
 * morirse, y lo que deja correr los scripts en CI, donde no hay archivo.
 */
export function readEnvFile(path = ENV_SETUP_PATH) {
  const contents = readFileOrNull(path);
  return contents === null ? {} : parseEnv(contents);
}

/**
 * La configuración efectiva: `.env.setup` por debajo, el entorno del proceso
 * por encima.
 *
 * Ese orden es lo que deja correr el mismo script en los dos lugares donde
 * tiene que correr. En la máquina del dueño los valores viven en el archivo;
 * en GitHub Actions no hay archivo y cada valor llega como variable de
 * entorno desde los secretos del repo. Ningún script necesita saber en cuál
 * de los dos está.
 *
 * Sólo se consideran claves que el entorno define como NO vacías: una
 * variable exportada en blanco no debe pisar un valor real del archivo.
 */
export function loadConfig(path = ENV_SETUP_PATH) {
  const fromFile = readEnvFile(path);
  const merged = { ...fromFile };

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string" && value.trim().length > 0) {
      merged[key] = value;
      if (isSecretKey(key)) registerSecret(value);
    }
  }

  return merged;
}

/** Looks up an executable on PATH, honouring PATHEXT-style suffixes. */
function findOnPath(name, extensions) {
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = join(dir, name + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Resolves the Google Cloud SDK's own Python entrypoint.
 *
 * On Windows `gcloud` on PATH is a `.cmd` shim, and Node refuses to spawn a
 * `.cmd` without `shell: true` (CVE-2024-27980). Rather than reintroduce a
 * shell just for gcloud, we call what the shim calls: the SDK's bundled
 * `python.exe` against `lib/gcloud.py`. This also sidesteps the SDK's Bash
 * wrapper, which on this machine fails with "Python was not found" because it
 * never sets CLOUDSDK_PYTHON and Windows answers with a Store alias stub.
 */
function resolveGcloud() {
  const shim = findOnPath("gcloud", IS_WINDOWS ? [".cmd", ".exe", ""] : [""]);
  if (shim === null) return null;

  const sdkRoot = resolve(dirname(shim), "..");
  const entry = join(sdkRoot, "lib", "gcloud.py");
  if (!existsSync(entry)) return null;

  const bundledPython = IS_WINDOWS
    ? join(sdkRoot, "platform", "bundledpython", "python.exe")
    : join(sdkRoot, "platform", "bundledpython", "bin", "python3");
  const python = existsSync(bundledPython)
    ? bundledPython
    : findOnPath(IS_WINDOWS ? "python" : "python3", IS_WINDOWS ? [".exe"] : [""]);
  if (python === null) return null;

  return { file: python, prefixArgs: [entry], env: { CLOUDSDK_PYTHON: python } };
}

/**
 * Resolves a globally npm-installed CLI to its JavaScript entrypoint so it can
 * run under the current `node` binary — again, no `.cmd`, no shell. The entry
 * comes from the package's own `bin` field rather than a hardcoded `dist/`
 * path, which differs per package (vercel ships `dist/vc.js`, neonctl ships
 * `bin/cli.js`).
 */
function resolveNpmCli(name) {
  const shim = findOnPath(name, IS_WINDOWS ? [".cmd", ""] : [""]);
  if (shim === null) return null;

  const packageRoot = join(dirname(shim), "node_modules", name);
  const manifestPath = join(packageRoot, "package.json");
  if (!existsSync(manifestPath)) return null;

  const { bin } = JSON.parse(readFileSync(manifestPath, "utf8"));
  const relativeEntry = typeof bin === "string" ? bin : bin?.[name];
  if (typeof relativeEntry !== "string") return null;

  const entry = join(packageRoot, relativeEntry);
  if (!existsSync(entry)) return null;

  return { file: process.execPath, prefixArgs: [entry], env: {} };
}

const RESOLVERS = {
  gcloud: resolveGcloud,
  vercel: () => resolveNpmCli("vercel"),
  neonctl: () => resolveNpmCli("neonctl"),
};

const resolutionCache = new Map();

/**
 * Maps a logical command name to something `spawnSync` can launch with
 * `shell: false` on both Windows and POSIX.
 */
export function resolveCommand(command) {
  const cached = resolutionCache.get(command);
  if (cached !== undefined) return cached;

  const resolver = RESOLVERS[command];
  let resolved = resolver === undefined ? null : resolver();

  if (resolved === null) {
    // Plain native executables (gh, docker, git) need no special handling.
    const direct = findOnPath(command, IS_WINDOWS ? [".exe", ".cmd", ""] : [""]);
    if (direct === null) {
      throw new Error(
        `No encuentro el ejecutable "${command}" en el PATH. Instalalo y volvé a correr el script.`,
      );
    }
    resolved = { file: direct, prefixArgs: [], env: {} };
  }

  resolutionCache.set(command, resolved);
  return resolved;
}

export class CommandError extends Error {
  constructor(command, status, stderr) {
    // Deliberately WITHOUT the argv: a credential passed as an argument would
    // be reprinted here, and the whole point is that it never gets printed.
    // The command name plus its own stderr is enough to act on.
    const detail = redact(stderr ?? "").trim();
    super(
      detail.length > 0
        ? `\`${command}\` falló (exit ${status}):\n${detail}`
        : `\`${command}\` falló (exit ${status}) sin escribir nada en stderr.`,
    );
    this.name = "CommandError";
    this.command = command;
    this.status = status;
  }
}

/**
 * Runs an external CLI and returns its trimmed stdout.
 *
 * @param {string} command Logical name: "gcloud", "vercel", "neonctl", "gh", ...
 * @param {string[]} args Arguments. NEVER put a credential here.
 * @param {object} [options]
 * @param {Record<string,string>} [options.env] Extra environment for the child.
 *   This is how tokens travel: `neonctl`, `vercel` and `gh` all read theirs
 *   from the environment, so `--token` on argv is never needed.
 * @param {boolean} [options.quiet] Set for commands that print a credential on
 *   SUCCESS (`neonctl connection-string`, `gcloud secrets versions access`,
 *   `vercel env pull`). Their stdout is returned to the caller but registered
 *   for redaction, so a later error cannot leak what this call produced.
 * @param {string} [options.input] Written to the child's stdin — the way a
 *   secret VALUE reaches a CLI without touching argv.
 * @param {boolean} [options.allowFailure] Return a result object instead of
 *   throwing, for probes whose failure is a legitimate answer ("does this
 *   resource already exist?").
 */
export function run(command, args = [], options = {}) {
  const { env = {}, quiet = false, input, allowFailure = false, cwd = REPO_ROOT } = options;

  for (const value of Object.values(env)) registerSecret(value);

  const resolved = resolveCommand(command);
  const result = spawnSync(resolved.file, [...resolved.prefixArgs, ...args], {
    cwd,
    env: { ...process.env, ...resolved.env, ...env },
    shell: false,
    encoding: "utf8",
    input,
    maxBuffer: 32 * 1024 * 1024,
  });

  if (result.error !== undefined) {
    throw new Error(`No pude lanzar \`${command}\`: ${redact(result.error.message)}`);
  }

  const stdout = (result.stdout ?? "").trim();
  if (quiet) registerSecret(stdout);

  if (result.status !== 0) {
    if (allowFailure) {
      return { ok: false, status: result.status, stdout, stderr: redact(result.stderr ?? "") };
    }
    throw new CommandError(command, result.status, result.stderr);
  }

  return allowFailure ? { ok: true, status: 0, stdout, stderr: result.stderr ?? "" } : stdout;
}
