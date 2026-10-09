/**
 * Tests de `pnpm relay` con agentes falsos: un script de node que, en cada
 * corrida, hace lo que le toca de una secuencia ("limit,finish" = la primera
 * vez imprime un mensaje de límite, la segunda marca RELEVO.md como
 * terminado). Nada de esto lanza codex, gemini ni claude, y la espera entre
 * vueltas usa un reloj inyectado: ningún test duerme de verdad.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { REPO_ROOT } from "./lib.mjs";
import {
  DEFAULT_MAX_RUNS,
  DEFAULT_WAIT_MINUTES,
  EXIT,
  matchLimit,
  parseRelay,
  readRelayConfig,
  runRelay,
} from "./relay.mjs";

const LIMIT_MESSAGE = "Error: You've hit your usage limit. Try again later.";

// Lo que imprime y hace un agente en cada corrida. Escribe su nombre en
// calls.txt ANTES de actuar: el orden de ese archivo es el orden real.
const FAKE_AGENT = `
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [root, name, sequence] = process.argv.slice(2);
const callsPath = join(root, "calls.txt");
let calls = [];
try { calls = readFileSync(callsPath, "utf8").split("\\n").filter(Boolean); } catch {}
const step = sequence.split(",")[calls.filter((c) => c === name).length] ?? "ok";
appendFileSync(callsPath, name + "\\n");
const relevo = join(root, "docs", "RELEVO.md");
const setState = (estado, extra = "") =>
  writeFileSync(relevo, readFileSync(relevo, "utf8").replace(/^estado: .*$/m, "estado: " + estado) + extra);
console.log("token-de-prueba-que-no-se-loguea " + name);
if (step === "limit") { console.error(${JSON.stringify(LIMIT_MESSAGE)}); process.exit(1); }
if (step === "limit-ok") { console.log(${JSON.stringify(LIMIT_MESSAGE)}); process.exit(0); }
if (step === "fail") { console.error("boom"); process.exit(1); }
if (step === "finish") setState("terminado");
if (step === "block") setState("bloqueado", "motivo-bloqueo: hace falta un humano\\n");
`;

const RELEVO_EN_CURSO = [
  "# Relevo",
  "",
  "estado: en-curso",
  "item: 6 — El aviso de inventario negativo",
  "rama: fix/inventory-negative-notice",
  "ultimo-paso: tests en rojo",
  "siguiente-paso: implementar el aviso",
  "actualizado: 2026-10-09 10:00 por claude",
  "",
].join("\n");

let root;
let fakeAgentPath;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "relay-test-"));
  mkdirSync(join(root, "docs"));
  writeFileSync(join(root, "docs", "RELEVO.md"), RELEVO_EN_CURSO);
  fakeAgentPath = join(root, "fake-agent.mjs");
  writeFileSync(fakeAgentPath, FAKE_AGENT);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function agent(name, sequence) {
  return {
    name,
    command: process.execPath,
    args: [fakeAgentPath, root, name, sequence, "{prompt}"],
    limitPatterns: ["you'?ve hit your usage limit"],
  };
}

function config(agents, overrides = {}) {
  return {
    prompt: "seguí desde siguiente-paso",
    waitMinutes: 60,
    maxRuns: 50,
    agents,
    ...overrides,
  };
}

function fakeClock() {
  const sleeps = [];
  return {
    sleeps,
    now: () => new Date("2026-10-09T15:00:00Z"),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  };
}

function captureOut() {
  const lines = [];
  return {
    lines,
    text: () => lines.join("\n"),
    log: (...parts) => lines.push(parts.join(" ")),
    error: (...parts) => lines.push(parts.join(" ")),
    write: () => {},
  };
}

// Sin PATH de por medio: el "comando" de un agente falso ya es la ruta de node.
const resolveDirect = (command) => ({ file: command, prefixArgs: [], env: {} });

function relay(agents, options = {}) {
  const { overrides, ...rest } = options;
  return runRelay({
    root,
    config: config(agents, overrides),
    clock: rest.clock ?? fakeClock(),
    out: rest.out ?? captureOut(),
    resolve: rest.resolve ?? resolveDirect,
    ...rest,
  });
}

function calls() {
  const path = join(root, "calls.txt");
  return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean) : [];
}

function logEntries() {
  const path = join(root, ".relay", "log.jsonl");
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe("parseRelay", () => {
  test("lee los campos del formato fijo e ignora lo demás", () => {
    const state = parseRelay(RELEVO_EN_CURSO);
    assert.equal(state.estado, "en-curso");
    assert.equal(state.rama, "fix/inventory-negative-notice");
    assert.equal(state["siguiente-paso"], "implementar el aviso");
    assert.equal(state["#"], undefined);
  });

  test("tolera CRLF: el archivo puede venir de un editor de Windows", () => {
    assert.equal(parseRelay(RELEVO_EN_CURSO.replaceAll("\n", "\r\n")).estado, "en-curso");
  });
});

describe("matchLimit", () => {
  test("devuelve el patrón y solo las líneas que matchearon", () => {
    const match = matchLimit(["todo bien", LIMIT_MESSAGE], [/you'?ve hit your usage limit/i]);
    assert.equal(match.pattern, "you'?ve hit your usage limit");
    assert.deepEqual(match.lines, [LIMIT_MESSAGE]);
  });

  test("sin coincidencias devuelve null", () => {
    assert.equal(matchLimit(["todo bien"], [/usage limit/i]), null);
  });
});

describe("runRelay", () => {
  test("con límite pasa al siguiente agente", async () => {
    const code = await relay([agent("a", "limit"), agent("b", "finish")]);
    assert.equal(code, EXIT.done);
    assert.deepEqual(calls(), ["a", "b"]);
  });

  test("terminando bien sigue con el MISMO agente", async () => {
    const code = await relay([agent("a", "ok,finish"), agent("b", "finish")]);
    assert.equal(code, EXIT.done);
    assert.deepEqual(calls(), ["a", "a"]);
  });

  test("un límite con salida 0 también cuenta como límite", async () => {
    const code = await relay([agent("a", "limit-ok"), agent("b", "finish")]);
    assert.equal(code, EXIT.done);
    assert.deepEqual(calls(), ["a", "b"]);
  });

  test("todos sin cuota: espera y vuelve a empezar por el primero", async () => {
    const clock = fakeClock();
    const code = await relay([agent("a", "limit,finish"), agent("b", "limit")], { clock });
    assert.equal(code, EXIT.done);
    assert.deepEqual(calls(), ["a", "b", "a"]);
    assert.deepEqual(clock.sleeps, [60 * 60 * 1000]);
  });

  test("la espera sale de waitMinutes", async () => {
    const clock = fakeClock();
    await relay([agent("a", "limit,finish")], { clock, overrides: { waitMinutes: 5 } });
    assert.deepEqual(clock.sleeps, [5 * 60 * 1000]);
  });

  test("terminado al arrancar: sale con 0 sin correr a nadie", async () => {
    writeFileSync(
      join(root, "docs", "RELEVO.md"),
      RELEVO_EN_CURSO.replace("en-curso", "terminado"),
    );
    const out = captureOut();
    const code = await relay([agent("a", "ok")], { out });
    assert.equal(code, EXIT.done);
    assert.deepEqual(calls(), []);
    assert.match(out.text(), /terminado/);
  });

  test("bloqueado: sale con 2 e imprime el motivo", async () => {
    const out = captureOut();
    const code = await relay([agent("a", "block")], { out });
    assert.equal(code, EXIT.blocked);
    assert.deepEqual(calls(), ["a"]);
    assert.match(out.text(), /hace falta un humano/);
  });

  test("dos fallos que no son límite seguidos: sale con 1 y el error", async () => {
    const out = captureOut();
    const code = await relay([agent("a", "fail,fail"), agent("b", "finish")], { out });
    assert.equal(code, EXIT.error);
    assert.deepEqual(calls(), ["a", "a"]);
    assert.match(out.text(), /a falló dos veces seguidas/);
  });

  test("un solo fallo no corta: se reintenta y sigue", async () => {
    const code = await relay([agent("a", "fail,finish")]);
    assert.equal(code, EXIT.done);
    assert.deepEqual(calls(), ["a", "a"]);
  });

  test("un estado que no es del formato corta con 1", async () => {
    writeFileSync(join(root, "docs", "RELEVO.md"), RELEVO_EN_CURSO.replace("en-curso", "listo"));
    const code = await relay([agent("a", "ok")]);
    assert.equal(code, EXIT.error);
    assert.deepEqual(calls(), []);
  });

  test("llega al máximo de corridas y sale con 3", async () => {
    const code = await relay([agent("a", "ok,ok,ok,ok")], { overrides: { maxRuns: 3 } });
    assert.equal(code, EXIT.maxRuns);
    assert.deepEqual(calls(), ["a", "a", "a"]);
  });

  test("una CLI que no está instalada se salta y se dice", async () => {
    const out = captureOut();
    const missing = { ...agent("gemini", "ok"), command: "gemini" };
    const code = await relay([missing, agent("b", "finish")], {
      out,
      resolve: (command) => (command === "gemini" ? null : resolveDirect(command)),
    });
    assert.equal(code, EXIT.done);
    assert.deepEqual(calls(), ["b"]);
    assert.match(out.text(), /Salto gemini: no está instalada/);
  });

  test("un agente sin banderas verificadas (args null) se salta", async () => {
    const out = captureOut();
    const code = await relay([{ ...agent("g", "ok"), args: null }, agent("b", "finish")], { out });
    assert.equal(code, EXIT.done);
    assert.deepEqual(calls(), ["b"]);
    assert.match(out.text(), /Salto g: sus banderas no están verificadas/);
  });

  test("sin ningún agente disponible sale con 1", async () => {
    const code = await relay([agent("a", "ok")], { resolve: () => null });
    assert.equal(code, EXIT.error);
  });

  test("un lock con un pid vivo impide arrancar", async () => {
    mkdirSync(join(root, ".relay"));
    writeFileSync(join(root, ".relay", "lock"), "4242");
    const out = captureOut();
    const code = await relay([agent("a", "finish")], { out, isAlive: (pid) => pid === 4242 });
    assert.equal(code, EXIT.error);
    assert.deepEqual(calls(), []);
    assert.match(out.text(), /pid 4242/);
    assert.equal(readFileSync(join(root, ".relay", "lock"), "utf8"), "4242");
  });

  test("un lock con un pid muerto es viejo: se reemplaza y se libera al salir", async () => {
    mkdirSync(join(root, ".relay"));
    writeFileSync(join(root, ".relay", "lock"), "4242");
    const out = captureOut();
    const code = await relay([agent("a", "finish")], { out, isAlive: () => false });
    assert.equal(code, EXIT.done);
    assert.deepEqual(calls(), ["a"]);
    assert.match(out.text(), /lock viejo/i);
    assert.equal(existsSync(join(root, ".relay", "lock")), false);
  });

  test("mientras corre, el lock tiene el pid del relevo", async () => {
    let seen;
    const code = await relay([agent("a", "finish")], {
      pid: 777,
      onRun: () => {
        seen = readFileSync(join(root, ".relay", "lock"), "utf8");
      },
    });
    assert.equal(code, EXIT.done);
    assert.equal(seen, "777");
  });

  test("el log tiene una línea por corrida y solo las líneas que matchearon", async () => {
    await relay([agent("a", "limit"), agent("b", "finish")]);
    const entries = logEntries();
    assert.equal(entries.length, 2);
    assert.equal(entries[0].agent, "a");
    assert.equal(entries[0].result, "limit");
    assert.equal(entries[0].pattern, "you'?ve hit your usage limit");
    assert.deepEqual(entries[0].lines, [LIMIT_MESSAGE]);
    assert.equal(entries[1].result, "ok");
    assert.ok(entries[0].start && entries[0].end);
    assert.doesNotMatch(readFileSync(join(root, ".relay", "log.jsonl"), "utf8"), /token-de-prueba/);
  });

  test("--dry-run muestra qué correría sin correr nada ni tomar el lock", async () => {
    const out = captureOut();
    const code = await relay([agent("a", "finish")], { out, dryRun: true });
    assert.equal(code, EXIT.done);
    assert.deepEqual(calls(), []);
    assert.equal(existsSync(join(root, ".relay", "lock")), false);
    assert.match(out.text(), /Correría a: /);
    assert.match(out.text(), /seguí desde siguiente-paso/);
  });

  test(".relay/stop para el relevo entre corridas y se borra", async () => {
    const code = await relay([agent("a", "ok,finish")], {
      onRun: () => writeFileSync(join(root, ".relay", "stop"), ""),
    });
    assert.equal(code, EXIT.done);
    assert.deepEqual(calls(), ["a"]);
    assert.equal(existsSync(join(root, ".relay", "stop")), false);
  });
});

describe("relay.config.json", () => {
  const configPath = join(REPO_ROOT, "relay.config.json");

  test("el orden es codex, gemini, claude, con los defaults pedidos", () => {
    const parsed = readRelayConfig(configPath);
    assert.deepEqual(
      parsed.agents.map((a) => a.name),
      ["codex", "gemini", "claude"],
    );
    assert.equal(parsed.waitMinutes, DEFAULT_WAIT_MINUTES);
    assert.equal(parsed.maxRuns, DEFAULT_MAX_RUNS);
    assert.match(parsed.prompt, /docs\/RELEVO\.md/);
  });

  test("cada agente con banderas dice de qué versión salen y pasa el prompt", () => {
    for (const entry of readRelayConfig(configPath).agents) {
      if (entry.args === null) continue;
      assert.ok(entry.verifiedWith, `${entry.name} sin verifiedWith`);
      assert.ok(entry.args.includes("{prompt}"), `${entry.name} no recibe el prompt`);
    }
  });

  test("los patrones de límite reconocen los mensajes conocidos", () => {
    const { agents } = readRelayConfig(configPath);
    const byName = Object.fromEntries(agents.map((a) => [a.name, a.limitPatterns]));
    assert.notEqual(matchLimit(["You've hit your usage limit."], byName.codex), null);
    assert.notEqual(matchLimit(["Claude AI usage limit reached|1760040000"], byName.claude), null);
    assert.notEqual(matchLimit(["You've hit your limit · resets 3pm"], byName.claude), null);
    assert.notEqual(matchLimit(["[API Error: RESOURCE_EXHAUSTED]"], byName.gemini), null);
    assert.equal(matchLimit(["agregar rate limiting al login"], byName.claude), null);
  });

  test("un patrón que no es una regex válida se rechaza con el agente y el patrón", () => {
    const badPath = join(root, "bad.json");
    writeFileSync(badPath, JSON.stringify(config([{ ...agent("a", "ok"), limitPatterns: ["("] }])));
    assert.throws(() => readRelayConfig(badPath), /a.*"\("/);
  });
});
