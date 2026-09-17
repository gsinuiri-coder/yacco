/**
 * Invariantes de vercel.json que ningún build ni ningún test de las apps ve.
 *
 * El más importante no es obvio: Vercel le AGREGA al destino de un rewrite,
 * como query string, cada parámetro de `has` que el destino no use — salvo que
 * el path del destino use algún parámetro con nombre. Con `has: host` y un
 * destino del estilo `/api/$1`, cada petición a producción llega a Cloud Run
 * como `/api/v1/customers?host=yacco-web.vercel.app`. El ValidationPipe de la
 * API corre con `forbidNonWhitelisted`, así que todo endpoint con un DTO de
 * query contestaría 400 — sólo en producción, porque las reglas de demo no
 * llevan `has`. Y el smoke no lo vería: sin credenciales, los guards contestan
 * 401 antes de validar la query. Ver D-012 en docs/ARQUITECTURA.md.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { REPO_ROOT } from "./lib.mjs";
import { TARGETS } from "./smoke.mjs";

const config = JSON.parse(readFileSync(join(REPO_ROOT, "vercel.json"), "utf8"));
const PRODUCTION_HOST = new URL(TARGETS.web).host;

function namedParams(pattern) {
  return [...pattern.matchAll(/:([A-Za-z_]\w*)/g)].map((match) => match[1]);
}

describe("vercel.json", () => {
  test("toda regla con `has` usa en el destino un parámetro con nombre del source", () => {
    for (const rule of config.rewrites.filter((r) => r.has !== undefined)) {
      const destinationPath = new URL(rule.destination).pathname;
      const shared = namedParams(rule.source).filter((name) =>
        namedParams(destinationPath).includes(name),
      );
      assert.ok(
        shared.length > 0,
        `${rule.source} -> ${rule.destination}: sin un parámetro con nombre en el destino, ` +
          "Vercel le agrega ?host=... a cada petición y la API la rechaza con 400",
      );
    }
  });

  test("el orden es: host de producción, cualquier otro host, fallback de la SPA", () => {
    const [prodApi, prodHealth, demoApi, demoHealth, spa] = config.rewrites;

    for (const rule of [prodApi, prodHealth]) {
      assert.deepEqual(rule.has, [{ type: "host", value: PRODUCTION_HOST }]);
      assert.ok(rule.destination.startsWith(TARGETS.apis.production));
    }
    for (const rule of [demoApi, demoHealth]) {
      // Sin condición: el default es demo (D-011).
      assert.equal(rule.has, undefined);
      assert.ok(rule.destination.startsWith(TARGETS.apis.demo));
    }
    assert.deepEqual(spa, { source: "/(.*)", destination: "/index.html" });
    assert.equal(config.rewrites.length, 5);
  });

  test("/health viaja con la MISMA regla de source que su par de /api, en los dos hosts", () => {
    const [prodApi, prodHealth, demoApi, demoHealth] = config.rewrites;
    assert.equal(prodApi.source, demoApi.source);
    assert.equal(prodHealth.source, demoHealth.source);
    assert.deepEqual(prodApi.has, prodHealth.has);
  });

  test("el host de producción es un literal, nunca una regex", () => {
    for (const rule of config.rewrites.filter((r) => r.has !== undefined)) {
      for (const condition of rule.has) {
        assert.match(condition.value, /^[a-z0-9.-]+$/, `${condition.value} no es un host literal`);
      }
    }
  });
});

describe("vercel.json — la instalación", () => {
  // `vercel build` corre el installCommand dentro del job «5 · Web a Vercel»,
  // que tiene un token de GCP y el de Vercel en el entorno (A3, fase 6). Sin
  // --ignore-scripts, cualquier postinstall de las ~960 dependencias corre ahí.
  test("installCommand no ejecuta scripts de instalación", () => {
    assert.match(config.installCommand, /(^|\s)--ignore-scripts(\s|$)/);
  });
});
