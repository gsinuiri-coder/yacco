/**
 * Tests de la lógica de evaluación de `pnpm smoke:prod`, sin red: las
 * funciones que deciden si una respuesta está sana están separadas de los
 * `fetch` justamente para poder probar acá los casos que en producción son
 * raros — y el que más importa es `environment: null`.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { REPO_ROOT } from "./lib.mjs";
import {
  WEB_SCREENS,
  checkFrameHeaders,
  checkHealth,
  checkNuxtShell,
  checkRejectedLogin,
  checkViewerSession,
} from "./smoke.mjs";

const PAGES_DIR = join(REPO_ROOT, "apps", "web-nuxt", "app", "pages");

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

describe("checkNuxtShell", () => {
  // Recortado del HTML que sirve el SSR de apps/web-nuxt en Vercel.
  const nuxtHtml =
    '<!DOCTYPE html><html lang="es-PE"><head><link rel="modulepreload" as="script" ' +
    'crossorigin href="/_nuxt/CIFJyZrO.js"><script type="module" src="/_nuxt/CTtSYJIt.js" ' +
    'crossorigin></script></head><body><div id="__nuxt"><div class="isolate"></div></div>' +
    '<div id="teleports"></div></body></html>';

  // El index.html del web React, tal cual lo servía yacco-web.vercel.app hasta
  // el corte (commit 19a3553): lo que tiene que FALLAR.
  const reactHtml =
    '<!doctype html><html lang="es"><head><script type="module" crossorigin ' +
    'src="/assets/index-Ba1lrbxK.js"></script></head><body><div id="root"></div></body></html>';

  test("el HTML del Nuxt: raíz y módulo de entrada", () => {
    assert.deepEqual(checkNuxtShell(nuxtHtml), {
      problems: [],
      entryPath: "/_nuxt/CTtSYJIt.js",
    });
  });

  test("el HTML del web React falla: el corte no ocurrió", () => {
    const result = checkNuxtShell(reactHtml);
    assert.equal(result.entryPath, null);
    assert.deepEqual(result.problems, [
      'el HTML no tiene <div id="__nuxt">: no lo sirve el web Nuxt',
      "el HTML no referencia ningún módulo en /_nuxt/*.js",
    ]);
  });
});

describe("checkFrameHeaders", () => {
  test("con los dos headers de A6 no hay problemas", () => {
    const headers = new Headers({
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "frame-ancestors 'none'",
    });
    assert.deepEqual(checkFrameHeaders(headers), []);
  });

  test("sin ninguno, los dos faltan", () => {
    assert.equal(checkFrameHeaders(new Headers({ "content-type": "text/html" })).length, 2);
  });

  test("un X-Frame-Options que no es DENY falla", () => {
    const headers = new Headers({
      "X-Frame-Options": "SAMEORIGIN",
      "Content-Security-Policy": "frame-ancestors 'none'",
    });
    assert.deepEqual(checkFrameHeaders(headers), ["falta X-Frame-Options: DENY"]);
  });
});

describe("WEB_SCREENS", () => {
  test("cada pantalla existe en apps/web-nuxt/app/pages", () => {
    // Nuxt no tiene fallback a index.html: una ruta que no exista da 404 en el
    // smoke. Esto lo ve antes del deploy.
    for (const screen of WEB_SCREENS) {
      const segments = screen === "/" ? ["index"] : screen.slice(1).split("/");
      const asPage = join(PAGES_DIR, `${segments.join("/")}.vue`);
      const asIndex = join(PAGES_DIR, ...segments, "index.vue");
      assert.ok(existsSync(asPage) || existsSync(asIndex), `${screen} no es una página del Nuxt`);
    }
  });
});

describe("checkViewerSession", () => {
  const healthy = () => ({
    login: { status: 200, body: { accessToken: "un-token" } },
    me: { status: 200, body: { id: "u-1", username: "smoke-viewer", roles: ["VIEWER"] } },
    catalog: { status: 200 },
    customers: { status: 403 },
  });

  test("sana: login, /auth/me con VIEWER, catálogo 200 y clientes 403", () => {
    assert.deepEqual(checkViewerSession(healthy()), []);
  });

  test("un login rechazado falla y no evalúa lo demás", () => {
    const problems = checkViewerSession({ login: { status: 401, body: {} } });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /devolvió 401/);
  });

  test("un 200 sin accessToken también falla", () => {
    assert.match(checkViewerSession({ login: { status: 200, body: {} } })[0], /login/);
  });

  test("si a la cuenta le agregaron un rol, falla aunque todo responda", () => {
    const checks = healthy();
    checks.me.body.roles = ["VIEWER", "ADMIN"];
    const problems = checkViewerSession(checks);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /SOLO \["VIEWER"\]/);
  });

  test("clientes con 200 falla: la cuenta lee el padrón", () => {
    const checks = healthy();
    checks.customers.status = 200;
    assert.match(checkViewerSession(checks)[0], /GET \/customers devolvió 200/);
  });

  test("el catálogo caído falla", () => {
    const checks = healthy();
    checks.catalog.status = 500;
    assert.match(checkViewerSession(checks)[0], /GET \/products devolvió 500/);
  });

  test("/auth/me caído falla", () => {
    const checks = healthy();
    checks.me = { status: 404, body: null };
    assert.match(checkViewerSession(checks)[0], /GET \/auth\/me devolvió 404/);
  });
});
