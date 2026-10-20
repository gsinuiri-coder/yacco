import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { readStatusState, renderStatus } from "./relay-status.mjs";

const NOW = new Date("2026-10-10T15:05:00.000Z");
const ESCAPE = "\u001b";
const ANSI_PATTERN = new RegExp(`${ESCAPE}\\[[0-9;]*m`, "g");
const LONG_STEP = Array.from({ length: 60 }, (_, index) => `palabra${index}`).join(" ");

let root;
let relayDir;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "relay-status-test-"));
  relayDir = join(root, ".relay");
  mkdirSync(relayDir);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeRelay({ lastStep = "tests en rojo", item = "Mejora del tablero" } = {}) {
  writeFileSync(
    join(relayDir, "RELEVO.md"),
    [
      "# Relevo",
      "",
      "status: in-progress",
      `item: ${item}`,
      "branch: feat/relay-status",
      `last-step: ${lastStep}`,
      "next-step: implementar el tablero",
      "blocked-reason:",
      "updated: 2026-10-10T09:00:00-05:00 por Codex",
      "",
    ].join("\n"),
  );
}

function writeCurrent() {
  writeFileSync(
    join(relayDir, "current.json"),
    JSON.stringify({
      agent: "codex",
      model: "modelo-prueba",
      run: 3,
      maxRuns: 50,
      start: "2026-10-10T15:00:00.000Z",
    }),
  );
}

function writeLog() {
  const entries = [
    {
      agent: "claude",
      start: "2026-10-10T14:55:00.000Z",
      end: "2026-10-10T14:55:09.000Z",
      result: "ok",
      pattern: null,
    },
    {
      agent: "antigravity",
      start: "2026-10-10T14:56:00.000Z",
      end: "2026-10-10T14:57:05.000Z",
      result: "limit",
      pattern: "quota exhausted",
    },
    {
      agent: "codex",
      start: "2026-10-10T14:58:00.000Z",
      end: "2026-10-10T14:58:02.000Z",
      result: "error",
      pattern: null,
    },
  ];
  writeFileSync(join(relayDir, "log.jsonl"), entries.map(JSON.stringify).join("\n") + "\n");
}

function fullState(isAlive = () => true) {
  writeRelay();
  writeCurrent();
  writeLog();
  writeFileSync(join(relayDir, "lock"), "4242");
  writeFileSync(join(relayDir, "stop"), "");
  return readStatusState(root, { isAlive });
}

/** Las celdas de cada fila de tabla (`│ a │ b │`), sin espacios de relleno. */
function rows(text) {
  return text
    .replace(ANSI_PATTERN, "")
    .split("\n")
    .filter((line) => line.startsWith("│"))
    .map((line) =>
      line
        .split("│")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
}

function rowOf(text, firstCell) {
  return rows(text).find((cells) => cells[0] === firstCell);
}

/** El valor de una fila del cuadro de arriba, con sus líneas de continuación. */
function valueOf(text, label) {
  const all = rows(text);
  const start = all.findIndex((cells) => cells[0] === label && cells.length === 2);
  assert.ok(start >= 0, `sin fila ${label}`);
  const values = [all[start][1]];
  for (const cells of all.slice(start + 1)) {
    if (cells.length !== 2 || cells[0] !== "") break;
    values.push(cells[1]);
  }
  return values;
}

function visibleWidths(text) {
  return text
    .replace(ANSI_PATTERN, "")
    .split("\n")
    .map((line) => line.length);
}

describe("relay:status", () => {
  test("muestra el relevo vivo, la corrida, RELEVO.md, las tres salidas y stop", () => {
    const text = renderStatus(fullState(), NOW, false);
    assert.deepEqual(
      [
        "Relevo",
        "Agente",
        "Modelo",
        "Corrida",
        "Hace",
        "Estado",
        "Ítem",
        "Rama",
        "Último paso",
        "Siguiente paso",
        "Actualizado",
        "Parada solicitada",
      ].map((label) => valueOf(text, label)[0]),
      [
        "corriendo (pid 4242)",
        "codex",
        "modelo-prueba",
        "3/50",
        "5 min",
        "in-progress",
        "Mejora del tablero",
        "feat/relay-status",
        "tests en rojo",
        "implementar el tablero",
        "2026-10-10T09:00:00-05:00 por Codex",
        "sí",
      ],
    );
    assert.ok(
      rows(text).some((cells) => cells.join("|") === "Agente|Inicio|Duración|Resultado"),
      "la tabla de corridas tiene sus cuatro columnas",
    );
    assert.deepEqual(rowOf(text, "claude"), ["claude", "09:55", "9 s", "ok"]);
    assert.deepEqual(rowOf(text, "antigravity"), [
      "antigravity",
      "09:56",
      "1 min 5 s",
      "límite · quota exhausted",
    ]);
    assert.deepEqual(rowOf(text, "codex"), ["codex", "09:58", "2 s", "error"]);
    assert.ok(!text.includes(`${ESCAPE}[`));
  });

  test("dibuja con bordes simples y la hora de Lima al pie", () => {
    const text = renderStatus(fullState(), NOW, false);
    for (const corner of ["┌", "┐", "└", "┘", "│", "─"]) assert.ok(text.includes(corner), corner);
    assert.match(text, /Hora: 10:05:00$/);
    const watching = renderStatus(fullState(), NOW, false, 100, Infinity, { watching: true });
    assert.match(watching, /Actualiza cada 5 s · Ctrl\+C para salir · hora 10:05:00$/);
  });

  for (const width of [60, 120]) {
    test(`con ancho ${width} ninguna línea pasa del ancho, con y sin color`, () => {
      writeRelay({ lastStep: LONG_STEP, item: `Ítem ${LONG_STEP}` });
      writeCurrent();
      writeLog();
      writeFileSync(join(relayDir, "lock"), "4242");
      const state = readStatusState(root, { isAlive: () => true });
      for (const useColor of [false, true]) {
        const text = renderStatus(state, NOW, useColor, width);
        for (const lineWidth of visibleWidths(text)) assert.ok(lineWidth <= width, `${lineWidth}`);
        assert.ok(visibleWidths(text).includes(width), "los bordes ocupan todo el ancho");
      }
    });
  }

  test("un ancho menor que 60 se dibuja con 60", () => {
    const text = renderStatus(fullState(), NOW, false, 30);
    assert.equal(Math.max(...visibleWidths(text)), 60);
  });

  test("un paso largo ocupa a lo sumo dos líneas y termina en «…»; un ítem largo, una", () => {
    writeRelay({ lastStep: LONG_STEP, item: `Ítem ${LONG_STEP}` });
    const text = renderStatus(readStatusState(root, { isAlive: () => false }), NOW, false, 80);
    const step = valueOf(text, "Último paso");
    assert.equal(step.length, 2);
    assert.ok(step[0].startsWith("palabra0 palabra1"));
    assert.ok(step[1].endsWith("…"));
    const item = valueOf(text, "Ítem");
    assert.equal(item.length, 1);
    assert.ok(item[0].endsWith("…"));
  });

  test("con alto chico no pasa del alto y se van primero las corridas más viejas", () => {
    const state = fullState();
    const full = renderStatus(state, NOW, false, 100);
    const height = full.split("\n").length - 1;
    const shorter = renderStatus(state, NOW, false, 100, height);
    assert.ok(shorter.split("\n").length <= height);
    assert.equal(rowOf(shorter, "claude"), undefined);
    assert.ok(rowOf(shorter, "codex"));

    const tiny = renderStatus(state, NOW, false, 100, 5);
    assert.equal(tiny.split("\n").length, 5);
    assert.ok(tiny.endsWith("…"));
  });

  test("un lock muerto no presenta current.json como una corrida viva", () => {
    const text = renderStatus(
      fullState(() => false),
      NOW,
      false,
    );
    assert.deepEqual(valueOf(text, "Relevo"), ["parado (el pid 4242 ya no existe)"]);
    assert.deepEqual(valueOf(text, "Agente"), ["codex · quedó de un relevo que murió"]);
    assert.equal(
      rows(text).find((cells) => cells[0] === "Hace"),
      undefined,
    );
  });

  test("si faltan archivos lo dice en cada fila y sigue", () => {
    const text = renderStatus(readStatusState(root, { isAlive: () => false }), NOW, false);
    assert.deepEqual(valueOf(text, "Relevo"), ["parado (falta .relay/lock)"]);
    assert.deepEqual(valueOf(text, "Corrida actual"), ["falta .relay/current.json"]);
    assert.deepEqual(valueOf(text, "RELEVO.md"), ["falta .relay/RELEVO.md"]);
    assert.match(text, /Últimas corridas: falta \.relay\/log\.jsonl/);
    assert.deepEqual(valueOf(text, "Parada solicitada"), ["no"]);
  });

  test("muestra el agente cuya confirmación está pendiente", () => {
    writeRelay();
    writeFileSync(
      join(relayDir, "waiting-confirmation.json"),
      JSON.stringify({
        agent: "claude",
        reason: "codex y antigravity quedaron sin cuota",
        createdAt: "2026-10-10T15:00:00.000Z",
      }),
    );

    const text = renderStatus(readStatusState(root, { isAlive: () => false }), NOW, false);
    assert.deepEqual(valueOf(text, "Confirmación"), [
      "claude la espera: codex y antigravity quedaron sin cuota",
    ]);
  });

  test("una corrida larga muestra su duración entera, también con ancho 60", () => {
    writeRelay();
    const run = {
      agent: "claude",
      start: "2026-10-10T03:00:00.000Z",
      end: "2026-10-10T13:59:59.000Z",
      result: "ok",
      pattern: null,
    };
    writeFileSync(join(relayDir, "log.jsonl"), JSON.stringify(run));
    const text = renderStatus(readStatusState(root, { isAlive: () => false }), NOW, false, 60);
    assert.deepEqual(rowOf(text, "claude"), ["claude", "22:00", "10 h 59 min 59 s", "ok"]);
  });

  test("sin corridas lo dice en la tabla", () => {
    writeRelay();
    writeFileSync(join(relayDir, "log.jsonl"), "");
    const text = renderStatus(readStatusState(root, { isAlive: () => false }), NOW, false);
    assert.deepEqual(rowOf(text, "(ninguna)"), ["(ninguna)", "", "", ""]);
  });

  test("muestra solo las últimas ocho corridas", () => {
    writeRelay();
    const entries = Array.from({ length: 9 }, (_, index) => ({
      agent: `agente-${index + 1}`,
      start: `2026-10-10T14:${String(index).padStart(2, "0")}:00.000Z`,
      end: `2026-10-10T14:${String(index).padStart(2, "0")}:01.000Z`,
      result: "ok",
      pattern: null,
    }));
    writeFileSync(join(relayDir, "log.jsonl"), entries.map(JSON.stringify).join("\n"));
    const text = renderStatus(readStatusState(root, { isAlive: () => false }), NOW, false);
    assert.equal(rowOf(text, "agente-1"), undefined);
    assert.ok(rowOf(text, "agente-2"));
    assert.ok(rowOf(text, "agente-9"));
  });

  test("colorea ok, límite, error, in-progress y blocked solo cuando se pide", () => {
    const state = fullState();
    state.relay.status = "blocked";
    state.relay["blocked-reason"] = "hace falta decidir";
    const colored = renderStatus(state, NOW, true);
    assert.ok(colored.includes(`${ESCAPE}[32mok${ESCAPE}[0m`));
    assert.ok(colored.includes(`${ESCAPE}[33mlímite${ESCAPE}[0m`));
    assert.ok(colored.includes(`${ESCAPE}[31merror${ESCAPE}[0m`));
    assert.ok(colored.includes(`${ESCAPE}[31mblocked${ESCAPE}[0m`));
    assert.ok(colored.includes(`${ESCAPE}[32mcorriendo${ESCAPE}[0m`));
    assert.deepEqual(valueOf(colored, "Motivo del bloqueo"), ["hace falta decidir"]);
    assert.ok(!renderStatus(state, NOW, false).includes(`${ESCAPE}[`));
  });
});
