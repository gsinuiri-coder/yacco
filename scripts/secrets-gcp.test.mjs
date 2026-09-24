/**
 * Tests de qué acepta subir `pnpm secrets:gcp` desde la configuración.
 *
 * El caso que importa es el de los JWT: subirlos desde .env.setup rota los
 * secretos de producción y los deja iguales a los de local. La protección no
 * puede depender de que quien corre el script lo sepa: tiene que fallar solo.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ENV_SETUP_PATH } from "./lib.mjs";
import {
  NEVER_UPLOADED_FROM_CONFIG,
  UPLOADABLE_FROM_CONFIG,
  checkCanRun,
  checkUploadsHaveValue,
  parseArgs,
} from "./secrets-gcp.mjs";

const FULL_CONFIG = {
  GCP_PROJECT_ID: "proyecto-de-prueba",
  NEON_PROJECT_ID: "neon-de-prueba",
  NEON_ORG_ID: "org-de-prueba",
  VERCEL_TOKEN: "un-token-de-prueba",
};

/** Un `run` falso que anota cada comando y contesta `ok` salvo lo que se le diga. */
function fakeRun(failing = () => false) {
  const calls = [];
  const runCommand = (command, args) => {
    calls.push([command, ...args].join(" "));
    return failing(command, args)
      ? { ok: false, status: 1, stdout: "", stderr: "NOT_FOUND" }
      : { ok: true, status: 0, stdout: "", stderr: "" };
  };
  return { calls, runCommand };
}

describe("parseArgs de secrets:gcp", () => {
  test("sin flags no sube NADA desde la configuración", () => {
    assert.deepEqual(parseArgs([]), { upload: [], envFile: ENV_SETUP_PATH, check: false });
  });

  test("--check se acepta, solo o junto a --upload", () => {
    assert.equal(parseArgs(["--check"]).check, true);
    assert.deepEqual(parseArgs(["--check", "--upload=VERCEL_TOKEN"]).upload, ["VERCEL_TOKEN"]);
  });

  test("--upload=VERCEL_TOKEN es lo único que se acepta hoy", () => {
    assert.deepEqual(parseArgs(["--upload=VERCEL_TOKEN"]).upload, ["VERCEL_TOKEN"]);
  });

  test("JWT_ACCESS_SECRET se rechaza, diciendo que rota producción", () => {
    const { error } = parseArgs(["--upload=JWT_ACCESS_SECRET"]);
    assert.match(error, /JWT_ACCESS_SECRET/);
    assert.match(error, /rota el secreto de producción/);
  });

  test("JWT_REFRESH_SECRET se rechaza aunque venga junto a una clave válida", () => {
    // Las dos claves a propósito: una lista que valida sólo la primera dejaría
    // pasar a la segunda.
    const { error } = parseArgs(["--upload=VERCEL_TOKEN,JWT_REFRESH_SECRET"]);
    assert.match(error, /JWT_REFRESH_SECRET/);
  });

  test("una clave que no está en la lista falla, aunque no sea un JWT", () => {
    const { error } = parseArgs(["--upload=NEON_API_KEY"]);
    assert.match(error, /no está en la lista/);
  });

  test("un argumento desconocido falla, en vez de ignorarse", () => {
    assert.match(parseArgs(["--all"]).error, /desconocido/);
  });

  test("--env-file cambia de dónde se lee la configuración", () => {
    assert.equal(parseArgs(["--env-file=C:/otra/.env.setup"]).envFile, "C:/otra/.env.setup");
  });
});

describe("las listas", () => {
  test("ninguna clave está a la vez en las dos listas", () => {
    for (const key of Object.keys(NEVER_UPLOADED_FROM_CONFIG)) {
      assert.equal(Object.hasOwn(UPLOADABLE_FROM_CONFIG, key), false, key);
    }
  });

  test("el token de Vercel va al secreto que lee CI", () => {
    assert.deepEqual(UPLOADABLE_FROM_CONFIG, { VERCEL_TOKEN: "yacco-ci-vercel-token" });
  });
});

describe("checkUploadsHaveValue", () => {
  // Un secreto vacío subido a Secret Manager EXISTE: pasa el preflight del
  // deploy, que sólo mira presencia, y revienta recién en el job de Vercel.
  test("VERCEL_TOKEN presente pero VACÍO falla, nombrando la clave", () => {
    const error = checkUploadsHaveValue({ VERCEL_TOKEN: "" }, ["VERCEL_TOKEN"]);
    assert.match(error, /VERCEL_TOKEN/);
    assert.match(error, /vacío/);
    assert.match(error, /No se subió nada/);
  });

  test("sólo espacios cuenta como vacío", () => {
    assert.match(checkUploadsHaveValue({ VERCEL_TOKEN: "   " }, ["VERCEL_TOKEN"]), /VERCEL_TOKEN/);
  });

  test("la clave ausente también falla", () => {
    assert.match(checkUploadsHaveValue({}, ["VERCEL_TOKEN"]), /VERCEL_TOKEN/);
  });

  test("con valor, no hay error", () => {
    assert.equal(
      checkUploadsHaveValue({ VERCEL_TOKEN: "un-token-de-prueba" }, ["VERCEL_TOKEN"]),
      null,
    );
  });

  test("sin nada pedido, un VERCEL_TOKEN vacío no importa: no se va a subir", () => {
    assert.equal(checkUploadsHaveValue({ VERCEL_TOKEN: "" }, []), null);
  });
});

// El paso previo a toda rotación de Neon (D-017): en el incidente, el script
// abortó DESPUÉS del reset porque faltaban los ids. --check tiene que fallar
// antes, y no puede escribir nada ni siquiera cuando pasa.
describe("checkCanRun (--check)", () => {
  test("sin los ids de GCP y Neon falla nombrándolos, sin lanzar ningún comando", () => {
    const { calls, runCommand } = fakeRun();
    const problems = checkCanRun({ VERCEL_TOKEN: "x" }, [], { run: runCommand });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /GCP_PROJECT_ID, NEON_PROJECT_ID, NEON_ORG_ID/);
    assert.deepEqual(calls, []);
  });

  test("con la config completa pasa, y ningún comando escribe ni lee un valor", () => {
    const { calls, runCommand } = fakeRun();
    assert.deepEqual(checkCanRun(FULL_CONFIG, ["VERCEL_TOKEN"], { run: runCommand }), []);
    assert.ok(calls.length > 0);
    for (const call of calls) {
      // Por palabra de comando, no por texto: `jwt-access-secret` es un nombre.
      const verbs = call.split(" ").filter((token) => !token.startsWith("--"));
      for (const verb of ["create", "add", "add-iam-policy-binding", "access", "delete"]) {
        assert.equal(verbs.includes(verb), false, call);
      }
    }
  });

  test("mira las dos ramas de Neon y los ocho secretos de runtime", () => {
    const { calls, runCommand } = fakeRun();
    checkCanRun(FULL_CONFIG, [], { run: runCommand });
    assert.equal(calls.filter((call) => call.startsWith("neonctl branches get")).length, 2);
    const secrets = calls.filter((call) => call.startsWith("gcloud secrets versions describe"));
    assert.equal(secrets.length, 8);
    assert.ok(secrets.some((call) => call.includes("--secret=yacco-production-direct-url")));
    assert.ok(secrets.some((call) => call.includes("--secret=yacco-demo-jwt-refresh-secret")));
  });

  test("un secreto que no se alcanza es un problema con su nombre", () => {
    // Uno solo falla y los demás no: si --check ignorara los resultados,
    // la lista quedaría vacía igual que con todo sano.
    const { runCommand } = fakeRun((_command, args) =>
      args.includes("--secret=yacco-production-database-url"),
    );
    const problems = checkCanRun(FULL_CONFIG, [], { run: runCommand });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /yacco-production-database-url/);
  });

  test("--check con --upload de un valor vacío falla antes de lanzar nada", () => {
    const { calls, runCommand } = fakeRun();
    const problems = checkCanRun({ ...FULL_CONFIG, VERCEL_TOKEN: "" }, ["VERCEL_TOKEN"], {
      run: runCommand,
    });
    assert.match(problems[0], /VERCEL_TOKEN/);
    assert.deepEqual(calls, []);
  });
});
