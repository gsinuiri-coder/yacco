/**
 * `pnpm relay` — corre la cola de Yacco con un agente a la vez y, cuando uno
 * se queda sin cuota, sigue con el siguiente (codex → gemini → claude, en el
 * orden de relay.config.json). Si todos están sin cuota, espera y vuelve a
 * empezar por el primero.
 *
 * El traspaso entre agentes no pasa por acá: cada agente lee y actualiza
 * .relay/RELEVO.md (formato en docs/RELEVO-USO.md; reglas en
 * .agents/rules/unattended-agents.md). Este script solo lee de ese archivo el
 * `status`, para saber cuándo parar:
 *
 *   done         sale con 0
 *   blocked      sale con 2 e imprime `blocked-reason`
 *   in-progress  corre al agente actual
 *
 * Y sale con 1 si un agente falla por algo que no es la cuota dos veces
 * seguidas (una corrida que sale bien sin tocar RELEVO.md cuenta como falla:
 * no avanzó), con 3 si llega a `maxRuns`, y con 4 si lo paró `.relay/stop`.
 *
 *   pnpm relay              arranca
 *   pnpm relay --dry-run    muestra qué correría, sin correr nada
 *
 * Uso, cómo pararlo y cómo leer el log: docs/RELEVO-USO.md. Cada agente corre
 * con el entorno en lista blanca (`AGENT_ENV_KEYS`) y su propio sandbox:
 * leé la advertencia de ese archivo antes.
 */
import { spawn } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { setTimeout } from "node:timers";
import { pathToFileURL } from "node:url";

import {
  REPO_ROOT,
  isSecretKey,
  readFileOrNull,
  redact,
  registerSecret,
  resolveCli,
} from "./lib.mjs";

export const DEFAULT_WAIT_MINUTES = 60;
export const DEFAULT_MAX_RUNS = 50;

export const EXIT = { done: 0, error: 1, blocked: 2, maxRuns: 3, stopped: 4 };

// El aviso de cuota de una CLI sale al final de su corrida. Buscarlo solo en
// las últimas líneas evita tomar por límite un archivo que el agente leyó a
// mitad de camino (relay.config.json mismo tiene los patrones adentro).
export const LIMIT_SCAN_LINES = 20;

// `redact` solo borra valores registrados. Esto atrapa además lo que tiene
// forma de credencial aunque nadie la haya registrado.
const TOKEN_SHAPES = [
  /sk-[A-Za-z0-9_-]{16,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /AIza[0-9A-Za-z_-]{35}/g,
  /Bearer\s+\S+/gi,
  /postgres(?:ql)?:\/\/\S+/gi,
];

// Claves y valores en inglés: son un enum de máquina, como cualquier otro
// identificador. El texto libre de cada campo va en español.
const STATES = new Set(["in-progress", "blocked", "done"]);
const RELAY_KEYS = new Set([
  "status",
  "item",
  "branch",
  "last-step",
  "next-step",
  "blocked-reason",
  "updated",
]);

/**
 * Las únicas variables del entorno que recibe un agente: lo que necesitan el
 * sistema, node y pnpm para correr, y GH_TOKEN para abrir y mergear PRs. Nada
 * de credenciales de nube (gcloud, Neon, Vercel) ni de la base: aunque una
 * regla falle, el agente no tiene con qué usarlas.
 */
export const AGENT_ENV_KEYS = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "HOMEDRIVE",
  "HOMEPATH",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USER",
  "USERNAME",
  "LOGNAME",
  "SHELL",
  "TERM",
  "LANG",
  "LC_ALL",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "PNPM_HOME",
  "COREPACK_HOME",
  "NODE_EXTRA_CA_CERTS",
  "GH_TOKEN",
];

/**
 * El entorno de un agente: solo las claves de `AGENT_ENV_KEYS`, comparadas
 * sin distinguir mayúsculas porque Windows tampoco las distingue (`Path`).
 */
export function buildAgentEnv(env) {
  const allowed = new Set(AGENT_ENV_KEYS);
  return Object.fromEntries(
    Object.entries(env).filter(
      ([key, value]) => allowed.has(key.toUpperCase()) && value !== undefined,
    ),
  );
}

// Una línea que matchea puede ser larga (un JSON de error entero): al log va
// recortada, y como mucho estas pocas.
const MAX_LOGGED_LINES = 5;
const MAX_LOGGED_LINE_LENGTH = 200;

/**
 * Los campos `clave: valor` del formato fijo de RELEVO.md. Cualquier otra
 * línea (un título, una explicación) se ignora; si una clave se repite, vale
 * la primera.
 */
export function parseRelay(text) {
  const state = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([a-z-]+):\s*(.*)$/.exec(line.trim());
    if (match === null || !RELAY_KEYS.has(match[1]) || match[1] in state) continue;
    state[match[1]] = match[2].trim();
  }
  return state;
}

function compilePatterns(agentName, patterns) {
  return (patterns ?? []).map((pattern) => {
    if (pattern instanceof RegExp) return pattern;
    try {
      return new RegExp(pattern, "i");
    } catch (error) {
      throw new Error(
        `relay.config.json: el patrón de límite ${JSON.stringify(pattern)} de ${agentName} ` +
          `no es una regex válida (${error.message}).`,
        { cause: error },
      );
    }
  });
}

/**
 * Lee relay.config.json, con los defaults puestos y los patrones de límite ya
 * compilados (sin distinguir mayúsculas). Un patrón inválido corta acá, antes
 * de lanzar a nadie, y no a mitad de la noche.
 */
export function readRelayConfig(path = join(REPO_ROOT, "relay.config.json")) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const invalid = (what) => new Error(`relay.config.json: ${what}.`);
  if (typeof raw.prompt !== "string" || raw.prompt.trim() === "") {
    throw invalid("falta `prompt` (un texto no vacío)");
  }
  if (!Array.isArray(raw.agents)) throw invalid("falta `agents` (una lista)");
  for (const key of ["waitMinutes", "maxRuns"]) {
    if (raw[key] !== undefined && !(Number.isInteger(raw[key]) && raw[key] > 0)) {
      throw invalid(`\`${key}\` tiene que ser un entero mayor que 0`);
    }
  }
  return {
    prompt: raw.prompt,
    waitMinutes: raw.waitMinutes ?? DEFAULT_WAIT_MINUTES,
    maxRuns: raw.maxRuns ?? DEFAULT_MAX_RUNS,
    agents: raw.agents.map((agent) => ({
      ...agent,
      limitPatterns: compilePatterns(agent.name, agent.limitPatterns),
    })),
  };
}

/** Registra como secreto cada valor del entorno cuya clave lo parece. */
export function registerEnvSecrets(env = process.env) {
  for (const [key, value] of Object.entries(env)) {
    if (isSecretKey(key)) registerSecret(value);
  }
}

/** Una línea sin secretos registrados ni nada con forma de credencial. */
export function redactLine(line) {
  return TOKEN_SHAPES.reduce((text, shape) => text.replace(shape, "***"), redact(line));
}

/**
 * El primer patrón que matchea alguna línea, con las líneas que matchearon
 * (sin secretos y recortadas). Esas líneas son lo único de la salida de un
 * agente que llega al log.
 */
export function matchLimit(lines, patterns) {
  for (const regex of patterns) {
    const matched = lines.filter((line) => regex.test(line));
    if (matched.length > 0) {
      return {
        pattern: regex.source,
        lines: matched
          .slice(0, MAX_LOGGED_LINES)
          .map((line) => redactLine(line.trim()).slice(0, MAX_LOGGED_LINE_LENGTH)),
      };
    }
  }
  return null;
}

/** ¿Sigue vivo ese proceso? EPERM es "existe, pero no es mío". */
export function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

class LockBusyError extends Error {}

/**
 * Toma `.relay/lock` con el pid. Crear el archivo con `wx` es atómico: dos
 * relevos que arrancan juntos no pueden ganar los dos. Si el lock ya existe y
 * su pid no está vivo, es de un relevo que murió sin limpiar: se reemplaza.
 * Devuelve la función que lo suelta.
 */
function acquireLock(relayDir, { pid, isAlive, out }) {
  mkdirSync(relayDir, { recursive: true });
  const lockPath = join(relayDir, "lock");
  try {
    writeFileSync(lockPath, String(pid), { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const holder = Number.parseInt((readFileOrNull(lockPath) ?? "").trim(), 10);
    const valid = Number.isInteger(holder) && holder > 0;
    if (valid && isAlive(holder)) {
      throw new LockBusyError(
        `Ya hay un relevo corriendo (pid ${holder}, ${lockPath}). Nunca dos agentes a la vez. ` +
          "Si no hay ninguno corriendo (Windows reusa pids), borrá ese archivo a mano.",
      );
    }
    out.log(`Lock viejo (${valid ? `pid ${holder} ya no existe` : "ilegible"}): lo reemplazo.`);
    // Borrar y volver a crear con `wx`, nunca sobrescribir: si otro relevo vio
    // el mismo lock viejo al mismo tiempo, solo uno de los dos lo crea.
    rmSync(lockPath, { force: true });
    try {
      writeFileSync(lockPath, String(pid), { flag: "wx" });
    } catch (retryError) {
      if (retryError.code !== "EEXIST") throw retryError;
      throw new LockBusyError(
        `Otro relevo tomó ${lockPath} al mismo tiempo que yo. Nunca dos agentes a la vez.`,
      );
    }
  }
  return () => {
    if ((readFileOrNull(lockPath) ?? "").trim() === String(pid)) unlinkSync(lockPath);
  };
}

function commandLine(agent, prompt) {
  return [agent.command, ...agent.args.map((arg) => (arg === "{prompt}" ? prompt : arg))];
}

/**
 * Corre un agente hasta que termina. Su salida pasa tal cual a la terminal
 * (`out.write`); de cada stream se guardan solo las últimas
 * `LIMIT_SCAN_LINES` líneas, que al terminar se revisan contra los patrones
 * de límite. Nada se guarda entero en ningún lado.
 */
function runAgent(agent, { prompt, root, out, onSpawn, env }) {
  const args = commandLine(agent, prompt).slice(1);
  return new Promise((resolvePromise) => {
    const tail = { stdout: [], stderr: [] };
    const pending = { stdout: "", stderr: "" };
    const scan = (stream, chunk, flush = false) => {
      const text = pending[stream] + chunk;
      const lines = text.split(/\r?\n/);
      pending[stream] = flush ? "" : lines.pop();
      tail[stream].push(...lines.filter((line) => line.trim() !== ""));
      tail[stream].splice(0, Math.max(0, tail[stream].length - LIMIT_SCAN_LINES));
    };

    const child = spawn(agent.resolved.file, [...agent.resolved.prefixArgs, ...args], {
      cwd: root,
      env: { ...buildAgentEnv(env), ...agent.resolved.env },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    onSpawn(child);
    for (const stream of ["stdout", "stderr"]) {
      child[stream].setEncoding("utf8");
      child[stream].on("data", (chunk) => {
        out.write(chunk);
        scan(stream, chunk);
      });
    }
    child.on("error", (error) => {
      resolvePromise({ code: null, error: error.message, limit: null });
    });
    child.on("close", (code) => {
      scan("stdout", "", true);
      scan("stderr", "", true);
      const lines = [...tail.stdout, ...tail.stderr];
      resolvePromise({ code, error: null, limit: matchLimit(lines, agent.limitPatterns) });
    });
  });
}

/**
 * Los agentes que se pueden correr, en orden. Uno sin banderas verificadas
 * (`args: null`) o cuya CLI no está instalada se salta, y se dice por qué.
 */
function availableAgents(agents, { resolve, out }) {
  const available = [];
  for (const agent of agents) {
    if (agent.args === null || agent.args === undefined) {
      out.log(
        `Salto ${agent.name}: sus banderas no están verificadas (args: null en relay.config.json).`,
      );
      continue;
    }
    const resolved = resolve(agent.command, agent.npmPackage);
    if (resolved === null) {
      out.log(`Salto ${agent.name}: no está instalada (no encuentro "${agent.command}").`);
      continue;
    }
    available.push({
      ...agent,
      limitPatterns: compilePatterns(agent.name, agent.limitPatterns),
      resolved,
    });
  }
  return available;
}

/**
 * Lee el estado de RELEVO.md. Devuelve el código de salida si hay que parar,
 * o `null` si hay que seguir.
 */
function stopCodeFor(relayPath, out) {
  const text = readFileOrNull(relayPath);
  if (text === null) {
    out.error(
      `No existe ${relayPath}: sin él ningún agente sabe por dónde seguir. ` +
        "Crealo con la plantilla de docs/RELEVO-USO.md.",
    );
    return EXIT.error;
  }
  const state = parseRelay(text);
  if (state.status === "done") {
    out.log("RELEVO.md dice done: la cola está cerrada.");
    return EXIT.done;
  }
  if (state.status === "blocked") {
    out.log(`RELEVO.md dice blocked: ${state["blocked-reason"] ?? "(sin blocked-reason)"}`);
    return EXIT.blocked;
  }
  if (!STATES.has(state.status)) {
    out.error(
      `RELEVO.md tiene status ${JSON.stringify(state.status ?? null)}; ` +
        "se esperaba in-progress, blocked o done.",
    );
    return EXIT.error;
  }
  return null;
}

function consumeStopFile(relayDir) {
  const stopPath = join(relayDir, "stop");
  if (readFileOrNull(stopPath) === null) return false;
  rmSync(stopPath, { force: true });
  return true;
}

function dryRun(agents, { prompt, relayPath, out }) {
  const code = stopCodeFor(relayPath, out);
  if (code !== null) {
    out.log(`--dry-run: el relevo saldría ahora con código ${code}, sin correr a nadie.`);
    return code;
  }
  for (const agent of agents) {
    const shown = commandLine(agent, prompt)
      .map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg))
      .join(" ");
    out.log(`Correría ${agent.name}: ${shown}`);
  }
  out.log("--dry-run: no corrí nada ni tomé el lock.");
  return EXIT.done;
}

const realClock = {
  now: () => new Date(),
  sleep: (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)),
};

const consoleOut = {
  log: (...parts) => console.log(...parts),
  error: (...parts) => console.error(...parts),
  write: (chunk) => process.stdout.write(chunk),
};

/**
 * El bucle del relevo. Todo lo que toca el mundo (reloj, PATH, pids, salida)
 * entra por parámetro para que los tests lo reemplacen. Devuelve el código de
 * salida; nunca llama a `process.exit`.
 */
export async function runRelay({
  root = REPO_ROOT,
  config,
  clock = realClock,
  out = consoleOut,
  resolve = resolveCli,
  pid = process.pid,
  isAlive = isPidAlive,
  dryRun: isDryRun = false,
  onRun = () => {},
  onLock = () => {},
  onSpawn = () => {},
  env = process.env,
}) {
  registerEnvSecrets(env);
  const relayDir = join(root, ".relay");
  // Fuera de docs/ y sin versionar: no cambia con cada checkout del agente.
  const relayPath = join(relayDir, "RELEVO.md");
  const agents = availableAgents(config.agents, { resolve, out });
  if (agents.length === 0) {
    out.error("Ningún agente disponible: no hay a quién correr.");
    return EXIT.error;
  }
  if (isDryRun) return dryRun(agents, { prompt: config.prompt, relayPath, out });

  let release;
  try {
    release = acquireLock(relayDir, { pid, isAlive, out });
  } catch (error) {
    if (!(error instanceof LockBusyError)) throw error;
    out.error(error.message);
    return EXIT.error;
  }
  onLock(release);

  try {
    return await relayLoop(agents, {
      config,
      clock,
      out,
      root,
      relayPath,
      relayDir,
      onRun,
      onSpawn,
      env,
    });
  } finally {
    release();
  }
}

async function relayLoop(
  agents,
  { config, clock, out, root, relayPath, relayDir, onRun, onSpawn, env },
) {
  const waitMs = config.waitMinutes * 60 * 1000;
  const exhausted = new Set();
  let current = 0;
  let failures = 0;

  for (let runs = 0; runs < config.maxRuns;) {
    if (consumeStopFile(relayDir)) {
      out.log("Encontré .relay/stop: paro acá, entre dos corridas.");
      return EXIT.stopped;
    }
    const stopCode = stopCodeFor(relayPath, out);
    if (stopCode !== null) return stopCode;

    const index = agents.findIndex((_, i) => i >= current && !exhausted.has(i));
    if (index === -1) {
      const until = new Date(clock.now().getTime() + waitMs);
      out.log(
        `Todos sin cuota. Espero ${config.waitMinutes} min (hasta ${until.toISOString()}) ` +
          `y vuelvo a empezar por ${agents[0].name}.`,
      );
      await clock.sleep(waitMs);
      exhausted.clear();
      current = 0;
      continue;
    }

    const agent = agents[index];
    current = index;
    const start = clock.now().toISOString();
    out.log(`\n=== Relevo: corrida ${runs + 1}/${config.maxRuns}, ${agent.name} ===`);
    const before = readFileOrNull(relayPath);
    const result = await runAgent(agent, { prompt: config.prompt, root, out, onSpawn, env });
    runs += 1;

    let outcome = "ok";
    if (result.limit !== null) outcome = "limit";
    else if (result.code !== 0) outcome = "error";
    // Salió bien pero no escribió RELEVO.md: no avanzó, y volver a correrlo
    // igual sería gastar corridas con aprobación automática.
    else if (readFileOrNull(relayPath) === before) outcome = "no-progress";
    appendFileSync(
      join(relayDir, "log.jsonl"),
      JSON.stringify({
        agent: agent.name,
        start,
        end: clock.now().toISOString(),
        result: outcome,
        exitCode: result.code,
        pattern: result.limit?.pattern ?? null,
        lines: result.limit?.lines ?? [],
      }) + "\n",
    );
    onRun(outcome);

    if (outcome === "limit") {
      out.log(`${agent.name} sin cuota (patrón: ${result.limit.pattern}). Paso al siguiente.`);
      exhausted.add(index);
      current = index + 1;
      failures = 0;
    } else if (outcome === "ok") {
      failures = 0;
    } else {
      failures += 1;
      const reason =
        outcome === "no-progress"
          ? "salió bien sin actualizar RELEVO.md"
          : (result.error ?? `salió con código ${result.code}`);
      if (failures >= 2) {
        out.error(`${agent.name} falló dos veces seguidas (${reason}). Paro el relevo.`);
        return EXIT.error;
      }
      out.log(`${agent.name} falló (${reason}). Lo reintento una vez.`);
    }
  }

  out.log(`Llegué al máximo de ${config.maxRuns} corridas: paro el relevo.`);
  return EXIT.maxRuns;
}

async function main(argv) {
  const known = new Set(["--dry-run"]);
  const unknown = argv.filter((arg) => !known.has(arg));
  if (unknown.length > 0) {
    console.error(`Argumento desconocido: ${unknown.join(" ")}. Uso: pnpm relay [--dry-run]`);
    return EXIT.error;
  }
  let release = () => {};
  let child = null;
  // Ctrl+C le llega al agente solo si comparten consola: se lo mata igual,
  // y se suelta el lock antes de salir.
  for (const [signal, code] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ]) {
    process.on(signal, () => {
      if (child !== null && child.exitCode === null) child.kill();
      release();
      process.exit(code);
    });
  }
  return runRelay({
    config: readRelayConfig(),
    dryRun: argv.includes("--dry-run"),
    onLock: (releaseLock) => {
      release = releaseLock;
    },
    onSpawn: (spawned) => {
      child = spawned;
    },
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`Relevo FALLÓ: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(EXIT.error);
    },
  );
}
