/**
 * Tests de la lógica de evaluación de `pnpm smoke:prod`, sin red: las
 * funciones que deciden si una respuesta está sana están separadas de los
 * `fetch` justamente para poder probar acá los casos que en producción son
 * raros — y el que más importa es `environment: null`.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { checkHealth, checkRejectedLogin, checkSpaShell } from "./smoke.mjs";

const SHA = "6a7e33e1acd8b7655b07b64f2d6881d59cfa5106";

describe("checkHealth", () => {
  test("sano: status ok, el entorno esperado y el commit esperado", () => {
    const body = { status: "ok", commit: SHA, environment: "production" };
    assert.deepEqual(
      checkHealth(body, { expectedEnvironment: "production", expectedCommit: SHA }),
      [],
    );
  });

  test("environment null FALLA aunque todo lo demás esté bien", () => {
    // El caso por el que existe el campo: un servicio desplegado sin APP_ENV.
    const body = { status: "ok", commit: SHA, environment: null };
    const problems = checkHealth(body, { expectedEnvironment: "demo", expectedCommit: SHA });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /environment es null/);
    assert.match(problems[0], /APP_ENV/);
  });

  test("un /health de antes del campo (sin environment) también FALLA", () => {
    // Es lo que contesta hoy una imagen previa al PR #131.
    const problems = checkHealth(
      { status: "ok", commit: null },
      { expectedEnvironment: "demo", expectedCommit: undefined },
    );
    assert.match(problems.join("\n"), /environment es null/);
  });

  test("el entorno equivocado falla: producción contestando desde demo", () => {
    // Los dos valores distintos a propósito: es el error que P-05 quiere ver.
    const problems = checkHealth(
      { status: "ok", commit: SHA, environment: "demo" },
      { expectedEnvironment: "production", expectedCommit: SHA },
    );
    assert.deepEqual(problems, ['environment es "demo", se esperaba "production"']);
  });

  test("un commit distinto del recién construido falla", () => {
    const problems = checkHealth(
      { status: "ok", commit: "0".repeat(40), environment: "production" },
      { expectedEnvironment: "production", expectedCommit: SHA },
    );
    assert.equal(problems.length, 1);
    assert.match(problems[0], /commit/);
  });

  test("sin commit esperado (corrida a mano) no se compara el commit", () => {
    const problems = checkHealth(
      { status: "ok", commit: "cualquiera", environment: "demo" },
      { expectedEnvironment: "demo", expectedCommit: undefined },
    );
    assert.deepEqual(problems, []);
  });

  test("un cuerpo que no es JSON falla sin romper", () => {
    assert.equal(checkHealth(null, { expectedEnvironment: "demo" }).length, 1);
  });
});

describe("checkRejectedLogin", () => {
  test("401 es lo esperado", () => {
    assert.deepEqual(checkRejectedLogin(401), []);
  });

  test("un 200 con un usuario inexistente es un problema grave", () => {
    assert.equal(checkRejectedLogin(200).length, 1);
  });

  test("404 dice que la ruta o el rewrite no llegan", () => {
    assert.match(checkRejectedLogin(404)[0], /rewrite/);
  });
});

describe("checkSpaShell", () => {
  const html =
    '<!doctype html><html><head><script type="module" crossorigin ' +
    'src="/assets/index-Cduw-oyP.js"></script></head><body><div id="root"></div></body></html>';

  test("el HTML construido por Vite: raíz y bundle", () => {
    assert.deepEqual(checkSpaShell(html), {
      problems: [],
      bundlePath: "/assets/index-Cduw-oyP.js",
    });
  });

  test("una página que no es la SPA falla", () => {
    const result = checkSpaShell("<html><body>404</body></html>");
    assert.equal(result.bundlePath, null);
    assert.equal(result.problems.length, 2);
  });
});
