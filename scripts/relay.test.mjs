/**
 * Tests de `pnpm relay` con agentes falsos: un script de node que, en cada
 * corrida, hace lo que le toca de una secuencia ("limit,finish" = la primera
 * vez imprime un mensaje de límite, la segunda marca RELEVO.md como
 * done). Nada de esto lanza codex, gemini ni claude, y la espera entre
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
  LIMIT_SCAN_LINES,
  matchLimit,
  parseRelay,
  readRelayConfig,
  runRelay,
} from "./relay.mjs";

const LIMIT_MESSAGE = "Error: You've hit your usage limit. Try again later.";
const REGISTERED_VALUE = "valor-registrado-en-el-entorno";
const TOKEN_LIKE = "sk-abcdefghijklmnopqrstuvwx";

// Lo que imprime y hace un agente en cada corrida. Escribe su nombre en
// calls.txt ANTES de actuar: el orden de ese archivo es el orden real. Un
// paso "ok" deja RELEVO.md distinto, como un agente que trabajó; "idle" sale
// bien sin tocarlo.
const FAKE_AGENT = `
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [root, name, sequence] = process.argv.slice(2);
const callsPath = join(root, "calls.txt");
let calls = [];
try { calls = readFileSync(callsPath, "utf8").split("\\n").filter(Boolean); } catch {}
const step = sequence.split(",")[calls.filter((c) => c === name).length] ?? "ok";
const run = calls.length + 1;
appendFileSync(callsPath, name + "\\n");
const relayPath = join(root, ".relay", "RELEVO.md");
const rewrite = (key, value, extra = "") =>
  writeFileSync(
    relayPath,
    readFileSync(relayPath, "utf8").replace(new RegExp("^" + key + ": .*$", "m"), key + ": " + value) + extra,
  );
const touch = () => rewrite("updated", "corrida " + run + " por " + name);
console.log("token-de-prueba-que-no-se-loguea " + name);
if (step === "limit") { console.error(${JSON.stringify(LIMIT_MESSAGE)}); process.exit(1); }
if (step === "limit-ok") { console.log(${JSON.stringify(LIMIT_MESSAGE)}); process.exit(0); }
if (step === "secret-limit") {
  console.error(${JSON.stringify(`${LIMIT_MESSAGE} ${REGISTERED_VALUE} ${TOKEN_LIKE}`)});
  process.exit(1);
}
if (step === "split-limit") {
  process.stderr.write(${JSON.stringify(LIMIT_MESSAGE.slice(0, 20))});
  await new Promise((resolve) => setTimeout(resolve, 50));
  process.stderr.write(${JSON.stringify(`${LIMIT_MESSAGE.slice(20)}\n`)});
  process.exit(1);
}
if (step === "noisy") {
  console.log(${JSON.stringify(LIMIT_MESSAGE)});
  for (let i = 0; i < 25; i++) console.log("trabajando, paso " + i);
  touch();
  process.exit(0);
}
if (step === "env") {
  writeFileSync(join(root, "env.json"), JSON.stringify(Object.keys(process.env)));
  touch();
  process.exit(0);
}
if (step === "fail") { console.error("boom"); process.exit(1); }
if (step === "ok") touch();
if (step === "finish") rewrite("status", "done");
if (step === "block") rewrite("status", "blocked", "blocked-reason: hace falta un humano\\n");
`;

const RELAY_IN_PROGRESS = [
  "# Relevo",
  "",
  "status: in-progress",
  "item: 6 — El aviso de inventario negativo",
  "branch: fix/inventory-negative-notice",
  "last-step: tests en rojo",
  "next-step: implementar el aviso",
  "updated: 2026-10-09 10:00 por claude",
  "",
].join("\n");

let root;
let fakeAgentPath;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "relay-test-"));
  mkdirSync(join(root, ".relay"));
  writeFileSync(join(root, ".relay", "RELEVO.md"), RELAY_IN_PROGRESS);
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
    prompt: "seguí desde next-step",
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
    const state = parseRelay(RELAY_IN_PROGRESS);
    assert.equal(state.status, "in-progress");
    assert.equal(state.branch, "fix/inventory-negative-notice");
    assert.equal(state["next-step"], "implementar el aviso");
    assert.equal(state["#"], undefined);
  });

  test("tolera CRLF: el archivo puede venir de un editor de Windows", () => {
    assert.equal(parseRelay(RELAY_IN_PROGRESS.replaceAll("\n", "\r\n")).status, "in-progress");
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

  test("done al arrancar: sale con 0 sin correr a nadie", async () => {
    writeFileSync(
      join(root, ".relay", "RELEVO.md"),
      RELAY_IN_PROGRESS.replace("in-progress", "done"),
    );
    const out = captureOut();
    const code = await relay([agent("a", "ok")], { out });
    assert.equal(code, EXIT.done);
    assert.deepEqual(calls(), []);
    assert.match(out.text(), /done/);
  });

  test("blocked: sale con 2 e imprime el motivo", async () => {
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

  test("un status que no es del formato corta con 1", async () => {
    writeFileSync(
      join(root, ".relay", "RELEVO.md"),
      RELAY_IN_PROGRESS.replace("in-progress", "listo"),
    );
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
    writeFileSync(join(root, ".relay", "lock"), "4242");
    const out = captureOut();
    const code = await relay([agent("a", "finish")], { out, isAlive: (pid) => pid === 4242 });
    assert.equal(code, EXIT.error);
    assert.deepEqual(calls(), []);
    assert.match(out.text(), /pid 4242/);
    assert.equal(readFileSync(join(root, ".relay", "lock"), "utf8"), "4242");
  });

  test("un lock con un pid muerto es viejo: se reemplaza y se libera al salir", async () => {
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
    assert.match(out.text(), /seguí desde next-step/);
  });

  test("una corrida que sale bien sin tocar RELEVO.md no avanzó: dos seguidas cortan", async () => {
    const out = captureOut();
    const code = await relay([agent("a", "idle,idle,idle")], { out });
    assert.equal(code, EXIT.error);
    assert.deepEqual(calls(), ["a", "a"]);
    assert.match(out.text(), /sin actualizar RELEVO\.md/);
    assert.deepEqual(
      logEntries().map((entry) => entry.result),
      ["no-progress", "no-progress"],
    );
  });

  test("un aviso de límite lejos del final no es un límite", async () => {
    const code = await relay([agent("a", "noisy,finish"), agent("b", "finish")]);
    assert.equal(code, EXIT.done);
    assert.deepEqual(calls(), ["a", "a"]);
  });

  test("un aviso de límite partido en dos escrituras se reconoce igual", async () => {
    const code = await relay([agent("a", "split-limit"), agent("b", "finish")]);
    assert.equal(code, EXIT.done);
    assert.deepEqual(calls(), ["a", "b"]);
    assert.deepEqual(logEntries()[0].lines, [LIMIT_MESSAGE]);
  });

  test("al log no llega un secreto del entorno ni algo con forma de credencial", async () => {
    await relay([agent("a", "secret-limit"), agent("b", "finish")], {
      env: { RELAY_TEST_TOKEN: REGISTERED_VALUE, HARMLESS: "no es secreto" },
    });
    const log = readFileSync(join(root, ".relay", "log.jsonl"), "utf8");
    assert.equal(logEntries()[0].result, "limit");
    assert.doesNotMatch(log, new RegExp(REGISTERED_VALUE));
    assert.doesNotMatch(log, new RegExp(TOKEN_LIKE));
    assert.match(log, /Try again later\. \*\*\* \*\*\*/);
  });

  test("un lock vacío es viejo: se reemplaza sin decir pid NaN", async () => {
    writeFileSync(join(root, ".relay", "lock"), "");
    const out = captureOut();
    const code = await relay([agent("a", "finish")], { out, isAlive: () => true });
    assert.equal(code, EXIT.done);
    assert.match(out.text(), /Lock viejo \(ilegible\)/);
    assert.doesNotMatch(out.text(), /NaN/);
  });

  test("--dry-run devuelve el código con que saldría la corrida real", async () => {
    writeFileSync(
      join(root, ".relay", "RELEVO.md"),
      RELAY_IN_PROGRESS.replace("in-progress", "listo"),
    );
    const code = await relay([agent("a", "finish")], { dryRun: true });
    assert.equal(code, EXIT.error);
  });

  test("el agente recibe solo el entorno en lista blanca: sin credenciales de nube ni de la base", async () => {
    await relay([agent("a", "env,finish")], {
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        GH_TOKEN: "token-de-gh",
        CLOUDSDK_CONFIG: "/home/x/.gcloud",
        NEON_API_KEY: "clave-neon",
        VERCEL_TOKEN: "token-vercel",
        DATABASE_URL: "postgres://u:p@h/db",
      },
    });
    const keys = JSON.parse(readFileSync(join(root, "env.json"), "utf8")).map((key) =>
      key.toUpperCase(),
    );
    assert.ok(keys.includes("PATH"));
    assert.ok(keys.includes("GH_TOKEN"));
    for (const forbidden of ["CLOUDSDK_CONFIG", "NEON_API_KEY", "VERCEL_TOKEN", "DATABASE_URL"]) {
      assert.ok(!keys.includes(forbidden), `${forbidden} llegó al agente`);
    }
  });

  test(".relay/stop para el relevo entre corridas y se borra", async () => {
    const code = await relay([agent("a", "ok,finish")], {
      onRun: () => writeFileSync(join(root, ".relay", "stop"), ""),
    });
    // Un código propio: quien lo opera distingue «lo paré yo» de «terminó».
    assert.equal(code, EXIT.stopped);
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
    assert.match(parsed.prompt, /\.relay\/RELEVO\.md/);
  });

  test("cada agente con banderas dice de qué versión salen y pasa el prompt", () => {
    for (const entry of readRelayConfig(configPath).agents) {
      if (entry.args === null) continue;
      assert.ok(entry.verifiedWith, `${entry.name} sin verifiedWith`);
      assert.ok(entry.args.includes("{prompt}"), `${entry.name} no recibe el prompt`);
    }
  });

  test("ningún agente corre sin sandbox ni con un modo que apruebe solo", () => {
    const forbidden = [
      "--dangerously-bypass-approvals-and-sandbox",
      "--dangerously-skip-permissions",
      "--allow-dangerously-skip-permissions",
      "bypassPermissions",
      "auto",
      "danger-full-access",
      "--yolo",
    ];
    const byName = Object.fromEntries(
      readRelayConfig(configPath).agents.map((entry) => [entry.name, entry.args]),
    );
    for (const [name, args] of Object.entries(byName)) {
      for (const flag of forbidden) {
        assert.ok(!(args ?? []).includes(flag), `${name} usa ${flag}`);
      }
    }
    assert.deepEqual(byName.codex.slice(1, 3), ["--sandbox", "workspace-write"]);
    const claudeMode = byName.claude[byName.claude.indexOf("--permission-mode") + 1];
    assert.equal(claudeMode, "dontAsk");
    const denied = byName.claude[byName.claude.indexOf("--disallowedTools") + 1];
    for (const cli of ["gcloud", "neonctl", "vercel", "gh workflow"]) {
      assert.match(denied, new RegExp(`Bash\\(${cli} \\*\\)`), `claude no deniega ${cli}`);
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
    writeFileSync(
      badPath,
      JSON.stringify(config([{ ...agent("agente-x", "ok"), limitPatterns: ["("] }])),
    );
    assert.throws(() => readRelayConfig(badPath), /"\(" de agente-x/);
  });

  test("una config sin prompt o con maxRuns inválido se rechaza con un mensaje claro", () => {
    const badPath = join(root, "bad.json");
    writeFileSync(badPath, JSON.stringify({ ...config([agent("a", "ok")]), prompt: "" }));
    assert.throws(() => readRelayConfig(badPath), /falta `prompt`/);
    writeFileSync(badPath, JSON.stringify(config([agent("a", "ok")], { maxRuns: 0 })));
    assert.throws(() => readRelayConfig(badPath), /`maxRuns` tiene que ser un entero/);
  });

  test("los patrones reales no confunden con un límite la config que un agente leyó", () => {
    const { agents } = readRelayConfig(configPath);
    const configLines = readFileSync(configPath, "utf8").split("\n");
    // Leerla a mitad de corrida no cuenta: solo se revisan las últimas
    // LIMIT_SCAN_LINES líneas, y estas quedan antes.
    const output = [...configLines, ...Array.from({ length: LIMIT_SCAN_LINES }, () => "listo")];
    for (const entry of agents) {
      assert.equal(
        matchLimit(output.slice(-LIMIT_SCAN_LINES), entry.limitPatterns),
        null,
        entry.name,
      );
    }
  });
});
