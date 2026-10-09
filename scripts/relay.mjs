/**
 * `pnpm relay` — corre la cola de Yacco con un agente a la vez y, cuando uno
 * se queda sin cuota, sigue con el siguiente (codex → gemini → claude, en el
 * orden de relay.config.json). Si todos están sin cuota, espera y vuelve a
 * empezar por el primero.
 *
 * El traspaso entre agentes no pasa por acá: cada agente lee y actualiza
 * docs/RELEVO.md (sección «Relevo entre agentes» de AGENTS.md). Este script
 * solo lee de ese archivo el `estado`, para saber cuándo parar:
 *
 *   terminado  sale con 0
 *   bloqueado  sale con 2 e imprime `motivo-bloqueo`
 *   en-curso   corre al agente actual
 *
 * Y sale con 1 si un agente falla por algo que no es la cuota dos veces
 * seguidas, y con 3 si llega a `maxRuns`.
 *
 *   pnpm relay              arranca
 *   pnpm relay --dry-run    muestra qué correría, sin correr nada
 *
 * Uso, cómo pararlo y cómo leer el log: docs/RELEVO-USO.md. Los agentes corren
 * con aprobación automática: leé la advertencia de ese archivo antes.
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

import { REPO_ROOT, readFileOrNull, redact, resolveCli } from "./lib.mjs";

export const DEFAULT_WAIT_MINUTES = 60;
export const DEFAULT_MAX_RUNS = 50;

export const EXIT = { done: 0, error: 1, blocked: 2, maxRuns: 3 };

const STATES = new Set(["en-curso", "bloqueado", "terminado"]);
const RELAY_KEYS = new Set([
  "estado",
  "item",
  "rama",
  "ultimo-paso",
  "siguiente-paso",
  "motivo-bloqueo",
  "actualizado",
]);

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

/**
 * El primer patrón que matchea alguna línea, con las líneas que matchearon
 * (recortadas y sin secretos conocidos). Esas líneas son lo único de la salida
 * de un agente que llega al log.
 */
export function matchLimit(lines, patterns) {
  for (const regex of patterns) {
    const matched = lines.filter((line) => regex.test(line));
    if (matched.length > 0) {
      return {
        pattern: regex.source,
        lines: matched
          .slice(0, MAX_LOGGED_LINES)
          .map((line) => redact(line.trim()).slice(0, MAX_LOGGED_LINE_LENGTH)),
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
    if (Number.isInteger(holder) && holder > 0 && isAlive(holder)) {
      throw new LockBusyError(
        `Ya hay un relevo corriendo (pid ${holder}, ${lockPath}). Nunca dos agentes a la vez.`,
      );
    }
    out.log(`Lock viejo (pid ${holder} ya no existe): lo reemplazo.`);
    writeFileSync(lockPath, String(pid));
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
 * (`out.write`) y se revisa línea por línea contra los patrones de límite; no
 * se guarda entera en ningún lado.
 */
function runAgent(agent, { prompt, root, out }) {
  const args = commandLine(agent, prompt).slice(1);
  return new Promise((resolvePromise) => {
    const matchedLines = [];
    const pending = { stdout: "", stderr: "" };
    const scan = (stream, chunk, flush = false) => {
      const text = pending[stream] + chunk;
      const lines = text.split(/\r?\n/);
      pending[stream] = flush ? "" : lines.pop();
      for (const line of lines) {
        if (agent.limitPatterns.some((regex) => regex.test(line))) matchedLines.push(line);
      }
    };

    const child = spawn(agent.resolved.file, [...agent.resolved.prefixArgs, ...args], {
      cwd: root,
      env: { ...process.env, ...agent.resolved.env },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
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
      resolvePromise({ code, error: null, limit: matchLimit(matchedLines, agent.limitPatterns) });
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
    out.error(`No existe ${relayPath}: sin él ningún agente sabe por dónde seguir.`);
    return EXIT.error;
  }
  const state = parseRelay(text);
  if (state.estado === "terminado") {
    out.log("RELEVO.md dice terminado: la cola está cerrada.");
    return EXIT.done;
  }
  if (state.estado === "bloqueado") {
    out.log(`RELEVO.md dice bloqueado: ${state["motivo-bloqueo"] ?? "(sin motivo-bloqueo)"}`);
    return EXIT.blocked;
  }
  if (!STATES.has(state.estado)) {
    out.error(
      `RELEVO.md tiene estado ${JSON.stringify(state.estado ?? null)}; ` +
        "se esperaba en-curso, bloqueado o terminado.",
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
    return EXIT.done;
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
}) {
  const relayPath = join(root, "docs", "RELEVO.md");
  const relayDir = join(root, ".relay");
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
    return await relayLoop(agents, { config, clock, out, root, relayPath, relayDir, onRun });
  } finally {
    release();
  }
}

async function relayLoop(agents, { config, clock, out, root, relayPath, relayDir, onRun }) {
  const waitMs = config.waitMinutes * 60 * 1000;
  const exhausted = new Set();
  let current = 0;
  let failures = 0;

  for (let runs = 0; runs < config.maxRuns;) {
    if (consumeStopFile(relayDir)) {
      out.log("Encontré .relay/stop: paro acá, entre dos corridas.");
      return EXIT.done;
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
    const result = await runAgent(agent, { prompt: config.prompt, root, out });
    runs += 1;

    let outcome = "ok";
    if (result.limit !== null) outcome = "limit";
    else if (result.code !== 0) outcome = "error";
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
      const reason = result.error ?? `salió con código ${result.code}`;
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
  // Ctrl+C también le llega al agente (mismo grupo de consola); acá solo hay
  // que soltar el lock antes de salir.
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      release();
      process.exit(130);
    });
  }
  return runRelay({
    config: readRelayConfig(),
    dryRun: argv.includes("--dry-run"),
    onLock: (releaseLock) => {
      release = releaseLock;
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
