/**
 * Tests de `pnpm relay` con agentes falsos: un script de node que, en cada
 * corrida, hace lo que le toca de una secuencia ("limit,finish" = la primera
 * vez imprime un mensaje de límite, la segunda marca RELEVO.md como
 * done). Nada de esto lanza codex, antigravity ni claude, y la espera entre
 * vueltas usa un reloj inyectado: ningún test duerme de verdad.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
  commandLine,
  gitIn,
  matchLimit,
  parseRelay,
  readRelayConfig,
  runRelay,
  stopCurrentRun,
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
if (step === "current" || step === "current-fail") {
  const current = readFileSync(join(root, ".relay", "current.json"), "utf8");
  writeFileSync(join(root, "current-" + run + ".json"), current);
  if (step === "current-fail") { console.error("boom current"); process.exit(1); }
  touch();
  process.exit(0);
}
if (step === "fail") { console.error("boom"); process.exit(1); }
if (step === "fail-noisy") {
  for (let i = 1; i <= 6; i++) console.error("error línea " + i);
  console.error("error línea 7 ${REGISTERED_VALUE} ${TOKEN_LIKE}");
  process.exit(1);
}
if (step === "dirty") {
  writeFileSync(join(root, "trabajo.txt"), "a medias\\n");
  touch();
  process.exit(1);
}
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
  for (const dir of remotes.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const remotes = [];

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

// El directorio temporal no es un repo: salvo en los tests de la red de
// seguridad, git responde «árbol limpio».
const cleanGit = () => ({ ok: true, status: 0, stdout: "", stderr: "" });

function relay(agents, options = {}) {
  const { overrides, ...rest } = options;
  return runRelay({
    root,
    config: config(agents, overrides),
    clock: rest.clock ?? fakeClock(),
    out: rest.out ?? captureOut(),
    resolve: rest.resolve ?? resolveDirect,
    git: rest.git ?? cleanGit,
    ...rest,
  });
}

function sh(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

/**
 * Convierte `root` en un repo en `branch`, con un remoto bare propio. Lo del
 * relevo y el agente falso quedan ignorados: lo único que puede ensuciar el
 * árbol es lo que el agente "trabajó".
 */
function initRepo(branch) {
  const remote = mkdtempSync(join(tmpdir(), "relay-remote-"));
  remotes.push(remote);
  sh(remote, "init", "-q", "--bare");
  sh(root, "init", "-q", "-b", branch);
  sh(root, "config", "user.name", "relay-test");
  sh(root, "config", "user.email", "relay-test@example.invalid");
  sh(root, "config", "commit.gpgsign", "false");
  writeFileSync(join(root, ".gitignore"), ".relay/\ncalls.txt\nfake-agent.mjs\nenv.json\n");
  sh(root, "add", ".gitignore");
  sh(root, "commit", "-q", "-m", "inicio");
  sh(root, "remote", "add", "origin", remote);
  return remote;
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

describe("stopCurrentRun", () => {
  test("una señal mata al agente, borra current.json y recién después libera el lock", () => {
    const currentPath = join(root, ".relay", "current.json");
    writeFileSync(currentPath, "corrida activa\n");
    const events = [];
    const child = {
      exitCode: null,
      kill: () => events.push("agente detenido"),
    };

    stopCurrentRun({
      child,
      root,
      release: () => events.push(`lock liberado; current existe: ${existsSync(currentPath)}`),
    });

    assert.deepEqual(events, ["agente detenido", "lock liberado; current existe: false"]);
    assert.equal(existsSync(currentPath), false);
  });
});

describe("runRelay", () => {
  test("un agente que requiere confirmación no se lanza después de agotar la cuota anterior", async () => {
    const clock = fakeClock();
    const out = captureOut();
    const code = await relay(
      [agent("a", "limit"), { ...agent("b", "finish"), confirmBeforeRun: true }],
      { clock, out },
    );

    assert.equal(code, EXIT.confirmation);
    assert.deepEqual(calls(), ["a"]);
    assert.deepEqual(clock.sleeps, []);
    assert.match(out.text(), /Esperando confirmación para b/);
    assert.match(out.text(), /a quedó sin cuota/);
    assert.match(out.text(), /pnpm relay --confirm b/);
    assert.deepEqual(
      JSON.parse(readFileSync(join(root, ".relay", "waiting-confirmation.json"), "utf8")),
      {
        agent: "b",
        reason: "a quedó sin cuota",
        createdAt: "2026-10-09T15:00:00.000Z",
      },
    );
  });

  test("la confirmación permite correr al agente durante esa ejecución", async () => {
    writeFileSync(join(root, ".relay", "waiting-confirmation.json"), "marca anterior\n");
    const code = await runRelay({
      root,
      config: config([agent("a", "limit"), { ...agent("b", "finish"), confirmBeforeRun: true }]),
      confirmedAgents: new Set(["b"]),
      clock: fakeClock(),
      out: captureOut(),
      resolve: resolveDirect,
      git: cleanGit,
    });

    assert.equal(code, EXIT.done);
    assert.deepEqual(calls(), ["a", "b"]);
    assert.equal(existsSync(join(root, ".relay", "waiting-confirmation.json")), false);
  });

  test("explica cuando llega al agente por dos fallas del anterior", async () => {
    const out = captureOut();
    const code = await relay(
      [agent("a", "fail,fail"), { ...agent("b", "finish"), confirmBeforeRun: true }],
      { out },
    );

    assert.equal(code, EXIT.confirmation);
    assert.deepEqual(calls(), ["a", "a"]);
    assert.match(out.text(), /a falló dos veces seguidas/);
  });

  test("un agente sin confirmBeforeRun corre como hasta ahora", async () => {
    const code = await relay([agent("a", "finish")]);
    assert.equal(code, EXIT.done);
    assert.deepEqual(calls(), ["a"]);
  });

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

  test("dos fallos que no son límite seguidos: el relevo pasa al siguiente agente", async () => {
    const out = captureOut();
    const code = await relay([agent("a", "fail,fail"), agent("b", "finish")], { out });
    assert.equal(code, EXIT.done);
    assert.deepEqual(calls(), ["a", "a", "b"]);
    assert.match(
      out.text(),
      /a falló dos veces seguidas \(salió con código 1\)\. Paso al siguiente/,
    );
  });

  test("sale con 1 solo cuando fallaron dos veces todos los agentes", async () => {
    const out = captureOut();
    const code = await relay([agent("a", "fail,fail"), agent("b", "fail,fail")], { out });
    assert.equal(code, EXIT.error);
    assert.deepEqual(calls(), ["a", "a", "b", "b"]);
    assert.match(out.text(), /Todos los agentes fallaron dos veces seguidas/);
  });

  test("un agente que falló dos veces no vuelve después de la espera por cuota", async () => {
    const clock = fakeClock();
    const code = await relay([agent("a", "fail,fail"), agent("b", "limit,finish")], { clock });
    assert.equal(code, EXIT.done);
    assert.deepEqual(calls(), ["a", "a", "b", "b"]);
    assert.deepEqual(clock.sleeps, [60 * 60 * 1000]);
  });

  test("el log guarda las últimas 5 líneas de stderr de una corrida fallida, redactadas", async () => {
    await relay([agent("a", "fail-noisy,finish")], {
      env: { RELAY_TEST_TOKEN: REGISTERED_VALUE },
    });
    const [failed, ok] = logEntries();
    assert.equal(failed.result, "error");
    assert.deepEqual(failed.stderr, [
      "error línea 3",
      "error línea 4",
      "error línea 5",
      "error línea 6",
      "error línea 7 *** ***",
    ]);
    assert.deepEqual(ok.stderr, []);
  });

  test("una corrida que termina por límite no guarda stderr, solo las líneas del límite", async () => {
    await relay([agent("a", "limit"), agent("b", "finish")]);
    assert.deepEqual(logEntries()[0].stderr, []);
  });

  test("la redacción tapa también un JWT, una clave AKIA y una clave privada PEM", () => {
    // Armados en tiempo de ejecución: un literal con esta forma dispara
    // gitleaks en CI aunque sea falso.
    const jwt = ["eyJ" + "hbGciOiJub25lIn0", "eyJ" + "zdWIiOiIxIn0", "ZmFsc28"].join(".");
    const akia = "AK" + "IA" + "X".repeat(16);
    const pem = ["-----BEGIN", "RSA", "PRIVATE", "KEY-----"].join(" ");
    const match = matchLimit([`límite ${jwt} ${akia} ${pem} MIIE`], [/límite/]);
    assert.equal(match.lines[0], "límite *** *** ***");
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
    const missing = { ...agent("antigravity", "ok"), command: "agy" };
    const code = await relay([missing, agent("b", "finish")], {
      out,
      resolve: (command) => (command === "agy" ? null : resolveDirect(command)),
    });
    assert.equal(code, EXIT.done);
    assert.deepEqual(calls(), ["b"]);
    assert.match(out.text(), /Salto antigravity: no está instalada \(no encuentro "agy"\)/);
  });

  test("un agente sin banderas verificadas (args null) se salta", async () => {
    const out = captureOut();
    const code = await relay([{ ...agent("g", "ok"), args: null }, agent("b", "finish")], { out });
    assert.equal(code, EXIT.done);
    assert.deepEqual(calls(), ["b"]);
    assert.match(out.text(), /Salto g: sus banderas no están verificadas/);
  });

  test("un agente declarado sin sandbox se avisa al arrancar, con su motivo", async () => {
    const out = captureOut();
    const unsandboxed = {
      ...agent("codex", "finish"),
      unsandboxed: true,
      unsandboxedReason: "prueba",
    };
    const code = await relay([unsandboxed], { out });
    assert.equal(code, EXIT.done);
    assert.match(
      out.text(),
      /AVISO: codex corre sin sandbox: tiene acceso completo a esta cuenta. Motivo: prueba/,
    );
  });

  test("un agente con sandbox no lleva el aviso", async () => {
    const out = captureOut();
    await relay([agent("codex", "finish")], { out });
    assert.doesNotMatch(out.text(), /corre sin sandbox/);
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

  test("current.json describe la corrida real y se borra cuando termina bien", async () => {
    const withModel = {
      ...agent("a", "current,finish"),
      model: "modelo-prueba",
      modelFlag: "--model",
    };
    const code = await relay([withModel], { overrides: { maxRuns: 3 } });
    assert.equal(code, EXIT.done);
    assert.deepEqual(JSON.parse(readFileSync(join(root, "current-1.json"), "utf8")), {
      agent: "a",
      model: "modelo-prueba",
      run: 1,
      maxRuns: 3,
      start: "2026-10-09T15:00:00.000Z",
    });
    assert.equal(existsSync(join(root, ".relay", "current.json")), false);
  });

  test("current.json también se borra cuando la corrida falla", async () => {
    const currentAfterRuns = [];
    const code = await relay([agent("a", "current-fail,finish")], {
      onRun: () => currentAfterRuns.push(existsSync(join(root, ".relay", "current.json"))),
    });
    assert.equal(code, EXIT.done);
    assert.equal(JSON.parse(readFileSync(join(root, "current-1.json"), "utf8")).run, 1);
    assert.deepEqual(currentAfterRuns, [false, false]);
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
    assert.match(out.text(), /Correría a \(modelo: [^)]*\): /);
    assert.match(out.text(), /seguí desde next-step/);
  });

  test("--dry-run muestra el modelo de cada agente", async () => {
    const out = captureOut();
    const withModel = { ...agent("a", "finish"), model: "modelo-a", modelFlag: "--model" };
    await relay([withModel, agent("b", "finish")], {
      out,
      dryRun: true,
    });
    assert.match(out.text(), /Correría a \(modelo: modelo-a\): .* --model modelo-a$/m);
    assert.match(out.text(), /Correría b \(modelo: el default de su CLI\): /);
  });

  test("--dry-run muestra qué agente requiere confirmación", async () => {
    const out = captureOut();
    await relay([{ ...agent("a", "finish"), confirmBeforeRun: true }], {
      out,
      dryRun: true,
    });
    assert.match(out.text(), /a requiere confirmación antes de correr/);
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

describe("red de seguridad: el WIP que deja un agente", () => {
  test("un agente que falla con el árbol sucio: commit WIP en su rama y push", async () => {
    const remote = initRepo("feat/item");
    const out = captureOut();
    const code = await relay([agent("a", "dirty,finish")], { out, git: gitIn(root) });
    assert.equal(code, EXIT.done);
    assert.equal(sh(root, "status", "--porcelain"), "");
    assert.match(
      sh(root, "log", "-1", "--format=%s"),
      /^wip\(relay\): a dejó cambios sin commitear/,
    );
    assert.equal(sh(root, "show", "HEAD:trabajo.txt"), "a medias");
    assert.equal(sh(remote, "rev-parse", "feat/item"), sh(root, "rev-parse", "HEAD"));
    assert.equal(logEntries()[0].wip.branch, "feat/item");
  });

  test("con el árbol limpio no commitea nada", async () => {
    initRepo("feat/item");
    const head = sh(root, "rev-parse", "HEAD");
    await relay([agent("a", "finish")], { git: gitIn(root) });
    assert.equal(sh(root, "rev-parse", "HEAD"), head);
    assert.equal(logEntries()[0].wip, null);
  });

  test("en main nunca commitea: RELEVO.md queda blocked y sale con 2", async () => {
    initRepo("main");
    const head = sh(root, "rev-parse", "HEAD");
    const out = captureOut();
    const code = await relay([agent("a", "dirty,finish")], { out, git: gitIn(root) });
    assert.equal(code, EXIT.blocked);
    assert.deepEqual(calls(), ["a"]);
    assert.equal(sh(root, "rev-parse", "HEAD"), head);
    const state = parseRelay(readFileSync(join(root, ".relay", "RELEVO.md"), "utf8"));
    assert.equal(state.status, "blocked");
    assert.match(state["blocked-reason"], /cambios sin commitear en main/);
    assert.match(out.text(), /cambios sin commitear en main/);
  });

  test("con HEAD suelto tampoco commitea: blocked", async () => {
    initRepo("feat/item");
    sh(root, "checkout", "-q", "--detach");
    const head = sh(root, "rev-parse", "HEAD");
    const code = await relay([agent("a", "dirty,finish")], { git: gitIn(root) });
    assert.equal(code, EXIT.blocked);
    assert.equal(sh(root, "rev-parse", "HEAD"), head);
    const state = parseRelay(readFileSync(join(root, ".relay", "RELEVO.md"), "utf8"));
    assert.match(state["blocked-reason"], /HEAD suelto/);
  });

  test("un merge con conflictos no se cierra con add -A: blocked y nada commiteado", async () => {
    initRepo("feat/item");
    writeFileSync(join(root, "f.txt"), "base\n");
    sh(root, "add", "f.txt");
    sh(root, "commit", "-q", "-m", "base");
    sh(root, "checkout", "-q", "-b", "otra");
    writeFileSync(join(root, "f.txt"), "otra\n");
    sh(root, "commit", "-q", "-am", "otra");
    sh(root, "checkout", "-q", "feat/item");
    writeFileSync(join(root, "f.txt"), "item\n");
    sh(root, "commit", "-q", "-am", "item");
    // Lo que dejaría un agente que arrancó un merge y salió sin resolverlo.
    spawnSync("git", ["merge", "-q", "otra"], { cwd: root });
    const head = sh(root, "rev-parse", "HEAD");
    const code = await relay([agent("a", "ok")], { git: gitIn(root) });
    assert.equal(code, EXIT.blocked);
    assert.equal(sh(root, "rev-parse", "HEAD"), head);
    const state = parseRelay(readFileSync(join(root, ".relay", "RELEVO.md"), "utf8"));
    assert.match(state["blocked-reason"], /conflictos sin resolver/);
  });

  test("si el push falla, el WIP queda commiteado, se avisa y el relevo sigue", async () => {
    initRepo("feat/item");
    sh(root, "remote", "set-url", "origin", join(root, "no-existe.git"));
    const out = captureOut();
    const code = await relay([agent("a", "dirty,finish")], { out, git: gitIn(root) });
    assert.equal(code, EXIT.done);
    assert.equal(sh(root, "show", "HEAD:trabajo.txt"), "a medias");
    assert.equal(logEntries()[0].wip.pushed, false);
    assert.match(out.text(), /El push de feat\/item falló/);
  });

  test("con el árbol limpio pero commits sin pushear, los pushea", async () => {
    const remote = initRepo("feat/item");
    sh(root, "push", "-q", "-u", "origin", "feat/item");
    writeFileSync(join(root, "hecho.txt"), "commiteado por el agente\n");
    sh(root, "add", "hecho.txt");
    sh(root, "commit", "-q", "-m", "trabajo del agente sin push");
    await relay([agent("a", "finish")], { git: gitIn(root) });
    assert.equal(sh(remote, "rev-parse", "feat/item"), sh(root, "rev-parse", "HEAD"));
    assert.equal(logEntries()[0].wip, null);
  });

  test("un commit que falla bloquea con el motivo en una sola línea y sin reinterpretar $&", async () => {
    const git = (args) => {
      if (args[0] === "status") return { ok: true, stdout: " M x.ts", stderr: "" };
      if (args[0] === "branch") return { ok: true, stdout: "feat/item", stderr: "" };
      if (args[0] === "commit")
        return { ok: false, stdout: "", stderr: "error: $& roto\nhint: otra" };
      return { ok: true, stdout: "", stderr: "" };
    };
    const code = await relay([agent("a", "ok")], { git });
    assert.equal(code, EXIT.blocked);
    const state = parseRelay(readFileSync(join(root, ".relay", "RELEVO.md"), "utf8"));
    assert.equal(
      state["blocked-reason"],
      "no pude commitear el WIP de a: error: $& roto · hint: otra",
    );
  });
});

describe("relay.config.json", () => {
  const configPath = join(REPO_ROOT, "relay.config.json");

  test("el orden es codex, antigravity, claude (siempre último), con los defaults pedidos", () => {
    const parsed = readRelayConfig(configPath);
    assert.deepEqual(
      parsed.agents.map((a) => a.name),
      ["codex", "antigravity", "claude"],
    );
    assert.equal(parsed.agents.at(-1).name, "claude");
    assert.equal(parsed.waitMinutes, DEFAULT_WAIT_MINUTES);
    assert.equal(parsed.maxRuns, DEFAULT_MAX_RUNS);
    assert.match(parsed.prompt, /\.relay\/RELEVO\.md/);
    assert.deepEqual(
      parsed.agents.filter((agent) => agent.confirmBeforeRun).map((agent) => agent.name),
      ["claude"],
    );
  });

  test("--confirm rechaza con claridad un nombre que no existe en la config", () => {
    const result = spawnSync(
      process.execPath,
      [join(REPO_ROOT, "scripts", "relay.mjs"), "--confirm", "nadie"],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
      },
    );

    assert.equal(result.status, EXIT.error);
    assert.match(result.stderr, /No existe el agente "nadie" en relay\.config\.json/);
  });

  test("cada agente con banderas dice de qué versión salen y pasa el prompt", () => {
    for (const entry of readRelayConfig(configPath).agents) {
      if (entry.args === null) continue;
      assert.ok(entry.verifiedWith, `${entry.name} sin verifiedWith`);
      assert.ok(entry.args.includes("{prompt}"), `${entry.name} no recibe el prompt`);
    }
  });

  test("sin sandbox solo con la clave explícita, y nunca un bypass ni un modo que apruebe solo", () => {
    const forbidden = [
      "--dangerously-bypass-approvals-and-sandbox",
      "--allow-dangerously-skip-permissions",
      "bypassPermissions",
      "auto",
      "--yolo",
    ];
    const unsandboxedFlags = ["danger-full-access", "--dangerously-skip-permissions"];
    const entries = readRelayConfig(configPath).agents;
    for (const entry of entries) {
      for (const flag of forbidden) {
        assert.ok(!(entry.args ?? []).includes(flag), `${entry.name} usa ${flag}`);
      }
      if (unsandboxedFlags.some((flag) => (entry.args ?? []).includes(flag))) {
        assert.equal(entry.unsandboxed, true, `${entry.name} sin unsandboxed: true`);
        assert.ok(entry.unsandboxedReason, `${entry.name} sin unsandboxedReason`);
      } else {
        assert.notEqual(entry.unsandboxed, true, `${entry.name} declara unsandboxed sin serlo`);
      }
    }
    const byName = Object.fromEntries(entries.map((entry) => [entry.name, entry.args]));
    // codex en Windows: sin sandbox por decisión explícita, con la política de
    // aprobación fijada para que `exec` no espere a nadie.
    assert.deepEqual(byName.codex.slice(1, 3), ["--sandbox", "danger-full-access"]);
    assert.ok(byName.codex.includes('approval_policy="never"'), "codex sin approval_policy never");
    const claudeMode = byName.claude[byName.claude.indexOf("--permission-mode") + 1];
    assert.equal(claudeMode, "dontAsk");
    const denied = byName.claude[byName.claude.indexOf("--disallowedTools") + 1];
    for (const cli of ["gcloud", "neonctl", "vercel", "gh workflow"]) {
      assert.match(denied, new RegExp(`Bash\\(${cli} \\*\\)`), `claude no deniega ${cli}`);
    }
  });

  test("cada agente fija su modelo, y el relevo lo convierte en --model al final", () => {
    const entries = readRelayConfig(configPath).agents;
    const models = Object.fromEntries(entries.map((entry) => [entry.name, entry.model]));
    assert.deepEqual(models, {
      codex: "gpt-5.6-sol",
      antigravity: "gemini-3.1-pro-high",
      claude: "claude-opus-5-5",
    });
    for (const entry of entries) {
      const line = commandLine(entry, "PROMPT");
      assert.deepEqual(line.slice(-2), ["--model", entry.model], entry.name);
      assert.equal(line.filter((arg) => arg === "--model").length, 1, entry.name);
      assert.ok(line.includes("PROMPT"), entry.name);
    }
  });

  test("un model en una CLI sin bandera verificada se rechaza al leer la config", () => {
    const badPath = join(root, "bad.json");
    const unknown = { ...agent("agente-x", "ok"), command: "otra-cli", model: "m-1" };
    writeFileSync(badPath, JSON.stringify(config([unknown])));
    assert.throws(() => readRelayConfig(badPath), /agente-x fija `model` pero otra-cli/);
  });

  test("antigravity corre sin TTY y sin sandbox, declarado como codex y con la versión verificada", () => {
    const entry = readRelayConfig(configPath).agents.find((a) => a.name === "antigravity");
    assert.equal(entry.command, "agy");
    // En esta máquina su --sandbox no anda y, sin él, el modo headless
    // deniega todo comando: la única forma de que trabaje es el bypass.
    assert.deepEqual(entry.args, ["-p", "{prompt}", "--dangerously-skip-permissions"]);
    assert.equal(entry.unsandboxed, true);
    assert.match(entry.unsandboxedReason, /docs\/RELEVO-USO\.md/);
    assert.match(entry.verifiedWith, /agy \d+\.\d+\.\d+/);
  });

  test("los patrones de límite reconocen los mensajes conocidos", () => {
    const { agents } = readRelayConfig(configPath);
    const byName = Object.fromEntries(agents.map((a) => [a.name, a.limitPatterns]));
    assert.notEqual(matchLimit(["You've hit your usage limit."], byName.codex), null);
    // Tal cual lo imprime codex-cli 0.162.0 (2026-10-10), con apóstrofo
    // tipográfico: el patrón con `'` recto no lo reconocía.
    assert.notEqual(
      matchLimit(
        [
          "ERROR: You’ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), " +
            "visit https://chatgpt.com/settings/usage to purchase more credits or try again at " +
            "Oct 14th, 2026 10:23 PM.",
        ],
        byName.codex,
      ),
      null,
    );
    assert.notEqual(matchLimit(["You’ve hit your limit · resets 3pm"], byName.claude), null);
    assert.notEqual(matchLimit(["Claude AI usage limit reached|1760040000"], byName.claude), null);
    assert.notEqual(matchLimit(["You've hit your limit · resets 3pm"], byName.claude), null);
    // Mensajes tal como están en el binario de agy 1.3.3.
    for (const line of [
      "You have exhausted your quota on this model.",
      'AGY_ERROR: {"short_error":"individual quota reached"}',
      "Your AI credits balance is too low to continue.",
      "stop_reason: STOP_REASON_QUOTA_EXHAUSTED",
      "[API Error: RESOURCE_EXHAUSTED]",
    ]) {
      assert.notEqual(matchLimit([line], byName.antigravity), null, line);
    }
    assert.equal(matchLimit(["Antigravity: 3 archivos editados"], byName.antigravity), null);
    assert.equal(matchLimit(["agregar rate limiting al login"], byName.claude), null);
  });

  test("danger-full-access sin la clave explícita se rechaza al leer la config", () => {
    const badPath = join(root, "bad.json");
    const unsandboxed = {
      ...agent("agente-x", "ok"),
      args: ["exec", "--sandbox", "danger-full-access"],
    };
    writeFileSync(badPath, JSON.stringify(config([unsandboxed])));
    assert.throws(
      () => readRelayConfig(badPath),
      /agente-x usa danger-full-access sin `unsandboxed: true`/,
    );
    writeFileSync(badPath, JSON.stringify(config([{ ...unsandboxed, unsandboxed: true }])));
    assert.throws(() => readRelayConfig(badPath), /unsandboxedReason/);
    const declared = { ...unsandboxed, unsandboxed: true, unsandboxedReason: "motivo" };
    writeFileSync(badPath, JSON.stringify(config([declared])));
    assert.equal(readRelayConfig(badPath).agents[0].name, "agente-x");
  });

  test("--dangerously-skip-permissions sin la clave explícita se rechaza al leer la config", () => {
    const badPath = join(root, "bad.json");
    const skip = {
      ...agent("agente-x", "ok"),
      args: ["-p", "{prompt}", "--dangerously-skip-permissions"],
    };
    writeFileSync(badPath, JSON.stringify(config([skip])));
    assert.throws(
      () => readRelayConfig(badPath),
      /agente-x usa --dangerously-skip-permissions sin `unsandboxed: true`/,
    );
    writeFileSync(
      badPath,
      JSON.stringify(config([{ ...skip, args: ["--dangerously-skip-permissions=true"] }])),
    );
    assert.throws(() => readRelayConfig(badPath), /sin `unsandboxed: true`/);
    writeFileSync(
      badPath,
      JSON.stringify(config([{ ...skip, args: ["exec", "--sandbox=danger-full-access"] }])),
    );
    assert.throws(() => readRelayConfig(badPath), /sin `unsandboxed: true`/);
    const declared = { ...skip, unsandboxed: true, unsandboxedReason: "motivo" };
    writeFileSync(badPath, JSON.stringify(config([declared])));
    assert.equal(readRelayConfig(badPath).agents[0].name, "agente-x");
  });

  test("--dangerously-bypass-approvals-and-sandbox se rechaza siempre, aun declarado", () => {
    const badPath = join(root, "bad.json");
    const bypass = {
      ...agent("agente-x", "ok"),
      args: ["exec", "--dangerously-bypass-approvals-and-sandbox"],
      unsandboxed: true,
      unsandboxedReason: "motivo",
    };
    writeFileSync(badPath, JSON.stringify(config([bypass])));
    assert.throws(() => readRelayConfig(badPath), /nunca se acepta/);
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
