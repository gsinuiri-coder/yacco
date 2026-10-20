/**
 * `pnpm relay:status` — tablero de solo lectura del relevo.
 *
 * Sin banderas, o sin terminal, imprime una vez. `--watch` en una terminal
 * entra a la pantalla alternativa y redibuja en el mismo lugar cada cinco
 * segundos, sin acumular nada en el historial. Todo se corta al ancho y al alto
 * de la terminal. También muestra si un agente espera confirmación. No toma el
 * lock, no escribe en `.relay/` y no llama a Git ni a un agente.
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
  // Pantalla alternativa y cursor oculto al entrar; al salir, al revés.
  enterScreen: "\u001b[?1049h\u001b[?25l",
  leaveScreen: "\u001b[?25h\u001b[?1049l",
  home: "\u001b[H",
  clearLineEnd: "\u001b[K",
  clearBelow: "\u001b[J",
};

const MIN_WIDTH = 60;
const DEFAULT_WIDTH = 100;
const STEP_LINES = 2;
const ELLIPSIS = "…";
const REFRESH_MS = 5000;
const MAX_AGENT_WIDTH = 16;
// «10 h 59 min 59 s». Con 60 de ancho, a Resultado le quedan sus 9.
const MAX_DURATION_WIDTH = 16;
const START_WIDTH = "Inicio".length;

const LIMA_MINUTES = new Intl.DateTimeFormat("es-PE", {
  timeZone: "America/Lima",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const LIMA_SECONDS = new Intl.DateTimeFormat("es-PE", {
  timeZone: "America/Lima",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

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
  const confirmation = readJson(join(relayDir, "waiting-confirmation.json"));
  const relayText = readText(join(relayDir, "RELEVO.md"));
  const relay = relayText.error === null ? parseRelay(relayText.value) : null;
  const log = readLog(join(relayDir, "log.jsonl"));

  return {
    lock,
    current: current.value,
    currentError: current.error,
    confirmation: confirmation.value,
    confirmationError: confirmation.error,
    relay,
    relayError: relayText.error,
    runs: log.value,
    logError: log.error,
    stop: existsSync(join(relayDir, "stop")),
  };
}

function paint(text, color, enabled) {
  return enabled && text !== "" ? `${ANSI[color]}${text}${ANSI.reset}` : text;
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

function missingValue(file, error) {
  if (error === "missing") return `falta .relay/${file}`;
  if (error === "invalid") return `.relay/${file} no tiene un formato válido`;
  return `no se pudo leer .relay/${file} (${error})`;
}

/** Corta un texto al ancho dado; si no entra, termina en «…». */
function fit(text, width) {
  if (text.length <= width) return text;
  return width <= 0 ? "" : `${text.slice(0, width - 1)}${ELLIPSIS}`;
}

/** Parte un texto en a lo sumo `maxLines` líneas del ancho dado, por palabras. */
function wrap(text, width, maxLines) {
  const lines = [];
  let rest = text.trim();
  while (rest !== "" && lines.length < maxLines) {
    if (rest.length <= width || lines.length === maxLines - 1) {
      lines.push(fit(rest, width));
      break;
    }
    const space = rest.lastIndexOf(" ", width);
    const cut = space > 0 ? space : width;
    lines.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  return lines.length === 0 ? [""] : lines;
}

/**
 * Una celda de `width` caracteres visibles: los trozos se cortan juntos y
 * cada uno conserva su color, que no cuenta para el ancho.
 */
function cell(segments, width, useColor) {
  const visible = fit(segments.map((segment) => segment.text).join(""), width);
  let painted = "";
  let offset = 0;
  for (const { text, color } of segments) {
    const piece = visible.slice(offset, offset + text.length);
    offset += text.length;
    painted += color ? paint(piece, color, useColor) : piece;
  }
  return `${painted}${" ".repeat(width - visible.length)}`;
}

const plain = (text) => [{ text }];
const colored = (text, color) => [{ text, color }];

/** Las filas del cuadro de arriba: etiqueta y una o más líneas de valor. */
function summaryRows(state, now) {
  const rows = [];
  const add = (label, segments) => rows.push({ label, segments });
  const addWrapped = (label, text) => rows.push({ label, wrapped: text });

  if (state.lock.state === "alive") {
    add("Relevo", [...colored("corriendo", "green"), ...plain(` (pid ${state.lock.pid})`)]);
  } else if (state.lock.state === "dead") {
    add("Relevo", plain(`parado (el pid ${state.lock.pid} ya no existe)`));
  } else if (state.lock.state === "missing") {
    add("Relevo", plain("parado (falta .relay/lock)"));
  } else if (state.lock.state === "invalid") {
    add("Relevo", plain("parado (.relay/lock es ilegible)"));
  } else {
    add("Relevo", plain(`parado (no se pudo leer .relay/lock: ${state.lock.error})`));
  }

  if (state.current === null) {
    add("Corrida actual", plain(missingValue("current.json", state.currentError)));
  } else {
    const alive = state.lock.state === "alive";
    const agent = alive
      ? state.current.agent
      : `${state.current.agent} · quedó de un relevo que murió`;
    add("Agente", plain(agent));
    add("Modelo", plain(state.current.model ?? "default de la CLI"));
    add("Corrida", plain(`${state.current.run}/${state.current.maxRuns}`));
    if (alive) {
      const started = new Date(state.current.start);
      add("Hace", plain(formatDuration(now.getTime() - started.getTime())));
    }
  }

  if (state.confirmation !== null) {
    addWrapped(
      "Confirmación",
      `${state.confirmation.agent} la espera: ${state.confirmation.reason}`,
    );
  } else if (state.confirmationError !== "missing") {
    add("Confirmación", plain(missingValue("waiting-confirmation.json", state.confirmationError)));
  }

  if (state.relay === null) {
    add("RELEVO.md", plain(missingValue("RELEVO.md", state.relayError)));
  } else {
    const color = relayColor(state.relay.status);
    add("Estado", color === null ? plain(state.relay.status) : colored(state.relay.status, color));
    add("Ítem", plain(state.relay.item ?? "(sin item)"));
    add("Rama", plain(state.relay.branch ?? "(sin branch)"));
    add("Actualizado", plain(state.relay.updated ?? "(sin updated)"));
    if (state.relay.status === "blocked") {
      addWrapped("Motivo del bloqueo", state.relay["blocked-reason"] || "(sin motivo)");
    }
    addWrapped("Último paso", state.relay["last-step"] ?? "(sin last-step)");
    addWrapped("Siguiente paso", state.relay["next-step"] ?? "(sin next-step)");
  }

  add("Parada solicitada", plain(state.stop ? "sí" : "no"));
  return rows;
}

function border(left, middle, right, widths) {
  return `${left}${widths.map((width) => "─".repeat(width + 2)).join(middle)}${right}`;
}

function tableRow(cells) {
  return `│ ${cells.join(" │ ")} │`;
}

function summaryBox(state, now, useColor, width) {
  const rows = summaryRows(state, now);
  const labelWidth = Math.max(...rows.map((row) => row.label.length));
  const valueWidth = width - labelWidth - 7;
  const lines = [border("┌", "┬", "┐", [labelWidth, valueWidth])];
  for (const row of rows) {
    const values = row.wrapped
      ? wrap(row.wrapped, valueWidth, STEP_LINES).map((line) => cell(plain(line), valueWidth))
      : [cell(row.segments, valueWidth, useColor)];
    values.forEach((value, index) => {
      const label = (index === 0 ? row.label : "").padEnd(labelWidth);
      lines.push(tableRow([label, value]));
    });
  }
  lines.push(border("└", "┴", "┘", [labelWidth, valueWidth]));
  return lines;
}

/** La tabla de las últimas corridas, con a lo sumo `maxRows` filas (las más nuevas). */
function runsTable(state, useColor, width, maxRows) {
  if (state.logError !== null) {
    return [fit(`Últimas corridas: ${missingValue("log.jsonl", state.logError)}`, width)];
  }
  const runs = state.runs.slice(-maxRows).map((run) => {
    const label = RESULT_LABELS[run.result] ?? run.result;
    const start = new Date(run.start).getTime();
    const end = new Date(run.end).getTime();
    return {
      agent: String(run.agent),
      // Una fecha ilegible en log.jsonl no tumba el tablero.
      start: Number.isNaN(start) ? "?" : LIMA_MINUTES.format(start),
      duration: Number.isNaN(start) || Number.isNaN(end) ? "?" : formatDuration(end - start),
      result: [
        ...colored(label, resultColor(run.result)),
        ...plain(run.pattern ? ` · ${run.pattern}` : ""),
      ],
    };
  });
  if (runs.length === 0) {
    runs.push({ agent: "(ninguna)", start: "", duration: "", result: plain("") });
  }
  const agentWidth = Math.min(
    MAX_AGENT_WIDTH,
    Math.max("Agente".length, ...runs.map((run) => run.agent.length)),
  );
  const durationWidth = Math.min(
    MAX_DURATION_WIDTH,
    Math.max("Duración".length, ...runs.map((run) => run.duration.length)),
  );
  const resultWidth = width - 13 - agentWidth - START_WIDTH - durationWidth;
  const widths = [agentWidth, START_WIDTH, durationWidth, resultWidth];
  const header = ["Agente", "Inicio", "Duración", "Resultado"];
  return [
    "Últimas corridas",
    border("┌", "┬", "┐", widths),
    tableRow(header.map((text, index) => cell(plain(text), widths[index]))),
    border("├", "┼", "┤", widths),
    ...runs.map((run) =>
      tableRow([
        cell(plain(run.agent), agentWidth),
        cell(plain(run.start), START_WIDTH),
        cell(plain(run.duration), durationWidth),
        cell(run.result, resultWidth, useColor),
      ]),
    ),
    border("└", "┴", "┘", widths),
  ];
}

/**
 * Arma todo el tablero solo a partir de estado, reloj, color, ancho y alto.
 * Ninguna línea pasa del ancho (mínimo 60) y el tablero no pasa del alto: si
 * no entra, primero se van las corridas más viejas.
 */
export function renderStatus(
  state,
  now = new Date(),
  useColor = false,
  columns = DEFAULT_WIDTH,
  rows = Number.POSITIVE_INFINITY,
  { watching = false } = {},
) {
  const width = Math.max(MIN_WIDTH, columns);
  const height = Math.max(1, rows);
  const clock = LIMA_SECONDS.format(now);
  const footer = fit(
    watching
      ? `Actualiza cada ${REFRESH_MS / 1000} s · Ctrl+C para salir · hora ${clock}`
      : `Hora: ${clock}`,
    width,
  );
  const top = [fit("TABLERO DEL RELEVO", width), ...summaryBox(state, now, useColor, width), ""];
  // La tabla necesita su título, tres bordes y el encabezado además de sus filas.
  const roomForRuns = height - top.length - 2 - 5;
  const runs = roomForRuns >= 1 ? [...runsTable(state, useColor, width, roomForRuns), ""] : [];
  const lines = [...top, ...runs, footer];
  if (lines.length <= height) return lines.join("\n");
  // Lo que no entra se corta con «…», pero el pie (la hora) se queda.
  if (height === 1) return ELLIPSIS;
  return [...lines.slice(0, height - 2), ELLIPSIS, footer].join("\n");
}

function terminalSize(interactive) {
  const { columns, rows } = process.stdout;
  return {
    // En la pantalla interactiva una columna menos: una línea que llega a la
    // última columna deja el cursor encima, y el \x1b[K borraría su borde.
    columns: interactive && columns > 0 ? columns - 1 : (columns ?? DEFAULT_WIDTH),
    rows: interactive && rows > 0 ? rows : Number.POSITIVE_INFINITY,
  };
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
  const tty = process.stdout.isTTY === true;
  const interactive = watching && tty;
  const useColor = tty && !("NO_COLOR" in process.env);
  const render = () => {
    const { columns, rows } = terminalSize(interactive);
    return renderStatus(readStatusState(), new Date(), useColor, columns, rows, {
      watching: interactive,
    });
  };

  if (!interactive) {
    console.log(render());
    return 0;
  }

  process.stdout.write(ANSI.enterScreen);
  process.on("exit", () => process.stdout.write(ANSI.leaveScreen));
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(0));
  // Cada línea borra lo que quedó a su derecha y el final borra lo de abajo:
  // nada se acumula en el historial de la terminal.
  // Un error al leer se muestra en la pantalla en vez de perderse al salir de ella.
  const safeRender = () => {
    try {
      return render();
    } catch (error) {
      return `Tablero del relevo FALLÓ: ${error instanceof Error ? error.message : error}`;
    }
  };
  const draw = () => {
    const screen = safeRender().split("\n").join(`${ANSI.clearLineEnd}\n`);
    process.stdout.write(`${ANSI.home}${screen}${ANSI.clearLineEnd}${ANSI.clearBelow}`);
  };
  draw();
  process.stdout.on("resize", draw);
  setInterval(draw, REFRESH_MS);
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
