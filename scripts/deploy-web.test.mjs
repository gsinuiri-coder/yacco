/**
 * La guardia de `pnpm deploy:web`: el `config.json` del Build Output se revisa
 * ANTES de `deploy --prebuilt` (D-021, D-023). Las rutas de estos tests copian
 * la forma de un `vercel build` real de apps/web-nuxt, recortada a lo que la
 * guardia mira más un par de rutas de Nitro alrededor, para que ninguna regla
 * pase por estar sola en la lista.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";

import { assertPublishable, checkBuildOutput, readBuildOutput } from "./deploy-web.mjs";

function withConfigFile(config, fn) {
  const dir = mkdtempSync(join(tmpdir(), "yacco-build-output-"));
  try {
    const path = join(dir, "config.json");
    if (config !== undefined) writeFileSync(path, JSON.stringify(config));
    return fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const PRODUCTION = "https://yacco-api-297699663114.us-east4.run.app";
const DEMO = "https://yacco-api-demo-297699663114.us-east4.run.app";
const HOST = [{ type: "host", value: "yacco-web.vercel.app" }];

const productionApi = { src: "^/api/(.*)$", dest: `${PRODUCTION}/api/$1`, has: HOST };
const productionHealth = { src: "^/health$", dest: `${PRODUCTION}/health`, has: HOST };
const demoApi = { src: "^/api/(.*)$", dest: `${DEMO}/api/$1` };
const demoHealth = { src: "^/health$", dest: `${DEMO}/health` };
const frameHeaders = {
  src: "/(.*)",
  headers: { "X-Frame-Options": "DENY", "Content-Security-Policy": "frame-ancestors 'none'" },
};
const nuxtAssets = {
  src: "/_nuxt(.*)",
  headers: { "cache-control": "public,max-age=31536000,immutable" },
  continue: true,
};
const ssrFallback = { src: "/(.*)", dest: "/__fallback" };

function buildOutput(proxyRoutes) {
  return {
    version: 3,
    routes: [nuxtAssets, ...proxyRoutes, frameHeaders, { handle: "filesystem" }, ssrFallback],
  };
}

describe("checkBuildOutput", () => {
  test("la salida de un build bueno pasa: producción por host, después el default a demo", () => {
    const config = buildOutput([productionApi, productionHealth, demoApi, demoHealth]);
    assert.deepEqual(checkBuildOutput(config), []);
  });

  test("sin la ruta por host de /api, falla aunque el default a demo esté", () => {
    // El default a demo y la regla de /health siguen ahí: lo único que falta es
    // lo que se prueba.
    const config = buildOutput([productionHealth, demoApi, demoHealth]);
    const problems = checkBuildOutput(config);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /falta la ruta \^\/api/);
    assert.match(problems[0], /yacco-web\.vercel\.app/);
  });

  test("la ruta por host DESPUÉS del default a demo falla: el default la tapa", () => {
    const config = buildOutput([demoApi, demoHealth, productionApi, productionHealth]);
    const problems = checkBuildOutput(config);
    assert.equal(problems.length, 2);
    for (const problem of problems) assert.match(problem, /DESPUÉS del default a demo/);
  });

  test("un host que no es el literal de producción no cuenta como la ruta de producción", () => {
    const previewHost = [
      { type: "host", value: "yacco-web-git-main-gsinuiricoders-projects.vercel.app" },
    ];
    const config = buildOutput([
      { ...productionApi, has: previewHost },
      productionHealth,
      demoApi,
      demoHealth,
    ]);
    assert.match(checkBuildOutput(config).join("\n"), /falta la ruta \^\/api/);
  });

  test("la ruta por host hacia demo no cuenta como la de producción", () => {
    const config = buildOutput([
      productionApi,
      { ...productionHealth, dest: `${DEMO}/health` },
      demoApi,
      demoHealth,
    ]);
    assert.match(checkBuildOutput(config).join("\n"), /falta la ruta \^\/health/);
  });

  test("el catch-all del web React a /index.html falla", () => {
    const config = buildOutput([productionApi, productionHealth, demoApi, demoHealth]);
    config.routes.push({ src: "/(.*)", dest: "/index.html" });
    assert.deepEqual(checkBuildOutput(config), [
      "hay una ruta hacia /index.html: el catch-all del web React taparía el SSR",
    ]);
  });

  test("sin los headers anti-enmarcado (A6) falla", () => {
    const config = buildOutput([productionApi, productionHealth, demoApi, demoHealth]);
    config.routes = config.routes.filter((route) => route !== frameHeaders);
    assert.deepEqual(checkBuildOutput(config), [
      "faltan los headers anti-enmarcado (A6) para /(.*)",
    ]);
  });

  test("un config.json sin routes falla", () => {
    assert.equal(checkBuildOutput({ version: 3 }).length, 1);
  });
});

describe("readBuildOutput", () => {
  test("un config.json ausente es un error, no una lista vacía de rutas", () => {
    withConfigFile(undefined, (path) => {
      assert.throws(() => readBuildOutput(path), /ENOENT/);
    });
  });
});

describe("assertPublishable — lo que main() corre entre build y deploy", () => {
  test("un build bueno en disco se deja publicar", () => {
    const config = buildOutput([productionApi, productionHealth, demoApi, demoHealth]);
    withConfigFile(config, (path) => assert.doesNotThrow(() => assertPublishable(path)));
  });

  test("un build con el default a demo delante de producción NO se publica", () => {
    const config = buildOutput([demoApi, demoHealth, productionApi, productionHealth]);
    withConfigFile(config, (path) => {
      assert.throws(() => assertPublishable(path), /El build no se publica[\s\S]*DESPUÉS/);
    });
  });

  test("sin config.json no se publica", () => {
    withConfigFile(undefined, (path) => assert.throws(() => assertPublishable(path), /ENOENT/));
  });
});

test("una CSP con más directivas sigue contando como A6", () => {
  const config = buildOutput([productionApi, productionHealth, demoApi, demoHealth]);
  config.routes = config.routes.map((route) =>
    route === frameHeaders
      ? {
          ...route,
          headers: {
            ...route.headers,
            "Content-Security-Policy": "default-src 'self'; frame-ancestors 'none'",
          },
        }
      : route,
  );
  assert.deepEqual(checkBuildOutput(config), []);
});
