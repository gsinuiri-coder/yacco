import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { readStatusState, renderStatus } from "./relay-status.mjs";

const NOW = new Date("2026-10-10T15:05:00.000Z");
const ESCAPE = "\u001b";

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

function writeRelay() {
  writeFileSync(
    join(relayDir, "RELEVO.md"),
    [
      "# Relevo",
      "",
      "status: in-progress",
      "item: Mejora del tablero",
      "branch: feat/relay-status",
      "last-step: tests en rojo",
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

describe("relay:status", () => {
  test("muestra el relevo vivo, la corrida, RELEVO.md, las tres salidas y stop", () => {
    const text = renderStatus(fullState(), NOW, false);
    for (const visible of [
      "Relevo: corriendo (pid 4242)",
      "Agente: codex",
      "Modelo: modelo-prueba",
      "Corrida: 3/50",
      "Hace: 5 min",
      "Estado: in-progress",
      "Ítem: Mejora del tablero",
      "Rama: feat/relay-status",
      "Último paso: tests en rojo",
      "Siguiente paso: implementar el tablero",
      "Actualizado: 2026-10-10T09:00:00-05:00 por Codex",
      "claude · 9 s · ok",
      "antigravity · 1 min 5 s · límite · quota exhausted",
      "codex · 2 s · error",
      "Parada solicitada: sí",
    ]) {
      assert.ok(text.includes(visible), visible);
    }
    assert.ok(!text.includes(`${ESCAPE}[`));
  });

  test("un lock muerto no presenta current.json como una corrida viva", () => {
    const text = renderStatus(
      fullState(() => false),
      NOW,
      false,
    );
    assert.match(text, /Relevo: parado \(el pid 4242 ya no existe\)/);
    assert.match(text, /Agente: codex · quedó de un relevo que murió/);
    assert.doesNotMatch(text, /Hace: 5 min/);
  });

  test("si faltan archivos lo dice en cada línea y sigue", () => {
    const text = renderStatus(readStatusState(root, { isAlive: () => false }), NOW, false);
    assert.match(text, /Relevo: parado \(falta \.relay\/lock\)/);
    assert.match(text, /Corrida actual: falta \.relay\/current\.json/);
    assert.match(text, /RELEVO\.md: falta \.relay\/RELEVO\.md/);
    assert.match(text, /Últimas corridas: falta \.relay\/log\.jsonl/);
    assert.match(text, /Parada solicitada: no/);
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
    assert.doesNotMatch(text, /agente-1 ·/);
    assert.match(text, /agente-2 ·/);
    assert.match(text, /agente-9 ·/);
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
    assert.match(colored, /Motivo del bloqueo: hace falta decidir/);
    assert.ok(!renderStatus(state, NOW, false).includes(`${ESCAPE}[`));
  });
});
