/**
 * `pnpm relay:status` — tablero de solo lectura del relevo.
 *
 * Sin banderas imprime una vez. `--watch` vuelve a leer y redibuja cada cinco
 * segundos. No toma el lock, no escribe en `.relay/` y no llama a Git ni a un
 * agente.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setInterval } from "node:timers";
import { pathToFileURL } from "node:url";

import { REPO_ROOT } from "./lib.mjs";
import { isPidAlive, parseRelay, readRelayConfig } from "./relay.mjs";

const ANSI = {
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  red: "\u001b[31m",
  reset: "\u001b[0m",
  clear: "\u001b[2J\u001b[H",
};

const RESULT_LABELS = {
  ok: "ok",
  limit: "límite",
  error: "error",
  "no-progress": "sin avance",
};

function readText(path) {
  try {
    return { value: readFileSync(path, "utf8"), error: null };
  } catch (error) {
    if (error.code === "ENOENT") return { value: null, error: "missing" };
    return { value: null, error: error.message };
  }
}

function readJson(path) {
  const text = readText(path);
  if (text.error !== null) return text;
  try {
    return { value: JSON.parse(text.value), error: null };
  } catch {
    return { value: null, error: "invalid" };
  }
}

function readLog(path) {
  const text = readText(path);
  if (text.error !== null) return { value: [], error: text.error };
  try {
    const entries = text.value
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line));
    return { value: entries.slice(-8), error: null };
  } catch {
    return { value: [], error: "invalid" };
  }
}

/** Lee el estado visible del relevo sin modificar ninguno de sus archivos. */
export function readStatusState(root = REPO_ROOT, { isAlive = isPidAlive } = {}) {
  const relayDir = join(root, ".relay");
  const lockText = readText(join(relayDir, "lock"));
  let lock = { state: "missing", pid: null };
  if (lockText.error === null) {
    const pid = Number.parseInt(lockText.value.trim(), 10);
    if (Number.isInteger(pid) && pid > 0) {
      lock = { state: isAlive(pid) ? "alive" : "dead", pid };
    } else {
      lock = { state: "invalid", pid: null };
    }
  } else if (lockText.error !== "missing") {
    lock = { state: "unreadable", pid: null, error: lockText.error };
  }

  const current = readJson(join(relayDir, "current.json"));
  const relayText = readText(join(relayDir, "RELEVO.md"));
  const relay = relayText.error === null ? parseRelay(relayText.value) : null;
  const log = readLog(join(relayDir, "log.jsonl"));

  return {
    lock,
    current: current.value,
    currentError: current.error,
    relay,
    relayError: relayText.error,
    runs: log.value,
    logError: log.error,
    stop: existsSync(join(relayDir, "stop")),
  };
}

function paint(text, color, enabled) {
  return enabled ? `${ANSI[color]}${text}${ANSI.reset}` : text;
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (hours > 0) parts.push(`${hours} h`);
  if (minutes > 0) parts.push(`${minutes} min`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds} s`);
  return parts.join(" ");
}

function relayColor(status) {
  if (status === "done") return "green";
  if (status === "in-progress") return "yellow";
  if (status === "blocked") return "red";
  return null;
}

function resultColor(result) {
  if (result === "ok") return "green";
  if (result === "limit") return "yellow";
  return "red";
}

function missingLine(label, file, error) {
  if (error === "missing") return `${label}: falta .relay/${file}`;
  if (error === "invalid") return `${label}: .relay/${file} no tiene un formato válido`;
  return `${label}: no se pudo leer .relay/${file} (${error})`;
}

/** Arma todo el tablero solo a partir de estado, reloj y preferencia de color. */
export function renderStatus(state, now = new Date(), useColor = false) {
  const lines = ["TABLERO DEL RELEVO", ""];
  if (state.lock.state === "alive") {
    lines.push(`Relevo: ${paint("corriendo", "green", useColor)} (pid ${state.lock.pid})`);
  } else if (state.lock.state === "dead") {
    lines.push(`Relevo: parado (el pid ${state.lock.pid} ya no existe)`);
  } else if (state.lock.state === "missing") {
    lines.push("Relevo: parado (falta .relay/lock)");
  } else if (state.lock.state === "invalid") {
    lines.push("Relevo: parado (.relay/lock es ilegible)");
  } else {
    lines.push(`Relevo: parado (no se pudo leer .relay/lock: ${state.lock.error})`);
  }

  if (state.current === null) {
    lines.push(missingLine("Corrida actual", "current.json", state.currentError));
  } else if (state.lock.state !== "alive") {
    lines.push(`Agente: ${state.current.agent} · quedó de un relevo que murió`);
    lines.push(`Modelo: ${state.current.model ?? "default de la CLI"}`);
    lines.push(`Corrida: ${state.current.run}/${state.current.maxRuns}`);
  } else {
    const started = new Date(state.current.start);
    lines.push(`Agente: ${state.current.agent}`);
    lines.push(`Modelo: ${state.current.model ?? "default de la CLI"}`);
    lines.push(`Corrida: ${state.current.run}/${state.current.maxRuns}`);
    lines.push(`Hace: ${formatDuration(now.getTime() - started.getTime())}`);
  }

  lines.push("");
  if (state.relay === null) {
    lines.push(missingLine("RELEVO.md", "RELEVO.md", state.relayError));
  } else {
    const color = relayColor(state.relay.status);
    const status = color === null ? state.relay.status : paint(state.relay.status, color, useColor);
    lines.push(`Estado: ${status}`);
    lines.push(`Ítem: ${state.relay.item ?? "(sin item)"}`);
    lines.push(`Rama: ${state.relay.branch ?? "(sin branch)"}`);
    lines.push(`Último paso: ${state.relay["last-step"] ?? "(sin last-step)"}`);
    lines.push(`Siguiente paso: ${state.relay["next-step"] ?? "(sin next-step)"}`);
    if (state.relay.status === "blocked") {
      lines.push(`Motivo del bloqueo: ${state.relay["blocked-reason"] || "(sin motivo)"}`);
    }
    lines.push(`Actualizado: ${state.relay.updated ?? "(sin updated)"}`);
  }

  lines.push("");
  if (state.logError !== null) {
    lines.push(missingLine("Últimas corridas", "log.jsonl", state.logError));
  } else {
    lines.push("Últimas corridas:");
    if (state.runs.length === 0) lines.push("  (ninguna)");
    for (const run of state.runs) {
      const duration = formatDuration(new Date(run.end).getTime() - new Date(run.start).getTime());
      const label = RESULT_LABELS[run.result] ?? run.result;
      const result = paint(label, resultColor(run.result), useColor);
      const pattern = run.pattern ? ` · ${run.pattern}` : "";
      lines.push(`  ${run.agent} · ${duration} · ${result}${pattern}`);
    }
  }
  lines.push("");
  lines.push(`Parada solicitada: ${state.stop ? "sí" : "no"}`);
  return lines.join("\n");
}

async function main(argv) {
  const watching = argv.length === 1 && argv[0] === "--watch";
  if (argv.length > 0 && !watching) {
    console.error(`Argumento desconocido: ${argv.join(" ")}. Uso: pnpm relay:status [--watch]`);
    return 1;
  }
  // Valida la misma config que usa el relevo y mantiene una única definición
  // de sus defaults, aunque el tablero solo necesite leer los archivos locales.
  readRelayConfig();
  const useColor = process.stdout.isTTY === true && !("NO_COLOR" in process.env);
  const draw = () => {
    if (watching && process.stdout.isTTY === true) process.stdout.write(ANSI.clear);
    console.log(renderStatus(readStatusState(), new Date(), useColor));
  };
  draw();
  if (watching) setInterval(draw, 5000);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).then(
    (code) => {
      if (code !== 0) process.exit(code);
    },
    (error) => {
      console.error(`Tablero del relevo FALLÓ: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    },
  );
}
