/**
 * Invariantes de la configuración de build del web en Vercel que ningún test
 * de las apps ve.
 *
 * Desde D-023 el proyecto `yacco-web` construye `apps/web-nuxt`
 * (`rootDirectory: apps/web-nuxt`), así que el vercel.json que manda es el de
 * esa carpeta. El proxy de `/api/*` y `/health` por host NO vive ahí: son las
 * rutas del Build Output API de D-021 (`apps/web-nuxt/config/api-proxy.ts`,
 * con su test), y la guardia de `scripts/deploy-web.mjs` las vuelve a revisar
 * en la salida real del build antes de publicar. Los headers A6 son
 * `routeRules` de nuxt.config (mismo test, y la misma guardia).
 *
 * Lo que se cuida acá es que no vuelva nada del web React: sus `rewrites`, y
 * sobre todo el catch-all `/(.*) -> /index.html`, que en Nuxt taparía el SSR.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, test } from "node:test";

import { REPO_ROOT } from "./lib.mjs";

const WEB_VERCEL_JSON = join(REPO_ROOT, "apps", "web-nuxt", "vercel.json");
const WEB_PACKAGE_JSON = join(REPO_ROOT, "apps", "web-nuxt", "package.json");
// El mismo archivo, en la raíz del repo: ahí vivía la config del web React.
const ROOT_CONFIG = join(REPO_ROOT, basename(WEB_VERCEL_JSON));

const config = JSON.parse(readFileSync(WEB_VERCEL_JSON, "utf8"));

/** Todo destino que declare la config de Vercel, en `rewrites` o en `routes`. */
function destinations(vercelJson) {
  return [...(vercelJson.rewrites ?? []), ...(vercelJson.routes ?? [])].map(
    (rule) => rule.destination ?? rule.dest,
  );
}

describe("apps/web-nuxt/vercel.json", () => {
  test("construye el Nuxt, y sólo el Nuxt", () => {
    assert.equal(config.framework, "nuxtjs");
    assert.match(config.buildCommand, /--filter @yacco\/web-nuxt build/);
  });

  test("el build de Vercel fija el preset vercel de Nitro, sin depender de la detección", () => {
    // En un runner de GitHub Actions std-env detecta `github_actions` antes que
    // el `VERCEL` de `vercel build`: Nitro sale `node-server`, no hay
    // `.vercel/output` y el job 5 falla («No Output Directory named "dist"»).
    const script = config.buildCommand.trim().split(/\s+/).at(-1);
    const { scripts } = JSON.parse(readFileSync(WEB_PACKAGE_JSON, "utf8"));
    assert.match(scripts[script] ?? "", /(^|\s)--preset[= ]vercel(\s|$)/);
  });

  test("no reescribe nada a /index.html: el catch-all del web React taparía el SSR", () => {
    assert.ok(
      !destinations(config).includes("/index.html"),
      "un catch-all a /index.html manda cada ruta al HTML estático y el SSR de Nuxt no contesta",
    );
  });

  test("no declara rewrites ni routes: el proxy por host son las rutas de D-021", () => {
    // Un rewrite de esta config con `has: host` le agrega ?host=... al destino
    // (D-012) y competiría en orden con las rutas que genera Nitro.
    assert.equal(config.rewrites, undefined);
    assert.equal(config.routes, undefined);
  });
});

describe("la raíz del repo", () => {
  test("no tiene config de Vercel propia: yacco-web construye desde apps/web-nuxt", () => {
    // Con rootDirectory en apps/web-nuxt Vercel lo ignoraría, y un archivo que
    // se lee como si mandara y no manda es la forma más barata de equivocarse.
    assert.equal(existsSync(ROOT_CONFIG), false);
  });
});

describe("apps/web-nuxt/vercel.json — la instalación", () => {
  // `vercel build` corre el installCommand dentro del job «5 · Web a Vercel»,
  // que tiene un token de GCP y el de Vercel en el entorno (A3, fase 6). Sin
  // --ignore-scripts, cualquier postinstall de las dependencias corre ahí.
  test("installCommand no ejecuta scripts de instalación", () => {
    assert.match(config.installCommand, /(^|\s)--ignore-scripts(\s|$)/);
  });
});
