/**
 * Tests de `pnpm viewer:bootstrap` sin red: qué usuario crea, cuándo lo da
 * por existente, y que la contraseña del admin sale de la terminal y NUNCA de
 * Secret Manager.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { REPO_ROOT } from "./lib.mjs";
import {
  bootstrapViewer,
  classifySecretRead,
  findViewer,
  viewerPlan,
  viewerUserBody,
} from "./viewer-bootstrap.mjs";
import { SMOKE_VIEWER_USERNAME } from "./smoke.mjs";

describe("viewerUserBody", () => {
  test("crea SOLO con el rol VIEWER, con el usuario que usa el smoke", () => {
    const body = viewerUserBody("una-clave-de-prueba");
    assert.deepEqual(body.roles, ["VIEWER"]);
    assert.equal(body.username, SMOKE_VIEWER_USERNAME);
    assert.equal(body.password, "una-clave-de-prueba");
  });
});

describe("findViewer", () => {
  test("encuentra la cuenta por su usuario", () => {
    const users = [
      { username: "admin", roles: ["ADMIN"] },
      { username: SMOKE_VIEWER_USERNAME, roles: ["VIEWER"] },
    ];
    assert.equal(findViewer(users)?.username, SMOKE_VIEWER_USERNAME);
  });

  test("otra cuenta VIEWER con otro usuario no cuenta como la del smoke", () => {
    assert.equal(findViewer([{ username: "otra-cuenta", roles: ["VIEWER"] }]), null);
  });
});

describe("classifySecretRead", () => {
  test("con valor: found", () => {
    assert.deepEqual(classifySecretRead({ ok: true, stdout: "x", stderr: "" }), {
      state: "found",
      value: "x",
    });
  });

  test("NOT_FOUND es lo único que cuenta como que no existe", () => {
    const result = {
      ok: false,
      stdout: "",
      stderr: "ERROR: (gcloud) NOT_FOUND: Secret [..] not found",
    };
    assert.equal(classifySecretRead(result).state, "missing");
  });

  test("un permiso denegado es error, no «no existe»", () => {
    const result = { ok: false, stdout: "", stderr: "ERROR: PERMISSION_DENIED: Permission denied" };
    assert.equal(classifySecretRead(result).state, "error");
  });
});

describe("viewerPlan", () => {
  const found = { state: "found", value: "clave" };
  const missing = { state: "missing" };
  const active = { username: "smoke-viewer", active: true };

  test("nada existe: se genera la contraseña y se crea la cuenta", () => {
    assert.deepEqual(viewerPlan({ account: null, secret: missing }), {
      storeNewPassword: true,
      createAccount: true,
    });
  });

  test("todo existe: no se escribe nada", () => {
    assert.deepEqual(viewerPlan({ account: active, secret: found }), {
      storeNewPassword: false,
      createAccount: false,
    });
  });

  test("hay secreto pero no cuenta: se crea con la contraseña guardada", () => {
    assert.deepEqual(viewerPlan({ account: null, secret: found }), {
      storeNewPassword: false,
      createAccount: true,
    });
  });

  test("un secreto ilegible aborta: nunca pisa una contraseña que quizá sirve", () => {
    assert.match(
      viewerPlan({ account: active, secret: { state: "error", detail: "x" } }).error,
      /No pude leer/,
    );
  });

  test("la cuenta sin su secreto aborta", () => {
    assert.match(
      viewerPlan({ account: active, secret: missing }).error,
      /nadie tiene su contraseña/,
    );
  });

  test("la cuenta desactivada aborta, aunque el secreto esté", () => {
    const inactive = { ...active, active: false };
    assert.match(viewerPlan({ account: inactive, secret: found }).error, /desactivada/);
  });
});

const ADMIN_SECRET = "yacco-admin-initial-password";
const ADMIN_PASSWORD = "contraseña-que-escribió-la-persona";
const VIEWER_PASSWORD = "contraseña-del-viewer-en-el-secreto";

/**
 * Producción de mentira: la cuenta VIEWER ya existe y su secreto también, que
 * es el caso de cada corrida después de la primera. `adminPasswords` es la
 * contraseña del admin que la API acepta — lo que F rota.
 */
function fakeProduction({ adminPassword = ADMIN_PASSWORD } = {}) {
  const gcloud = [];
  const logins = [];
  const run = (command, args) => {
    gcloud.push([command, ...args].join(" "));
    if (args.includes("access"))
      return { ok: true, status: 0, stdout: VIEWER_PASSWORD, stderr: "" };
    return "";
  };
  const routes = {
    "POST /auth/login": (body) => {
      logins.push(body.username);
      const valid =
        (body.username === "admin" && body.password === adminPassword) ||
        (body.username === "smoke-viewer" && body.password === VIEWER_PASSWORD);
      return valid ? [200, { accessToken: `token-${body.username}` }] : [401, {}];
    },
    "GET /users?role=VIEWER&active=true": () => [200, [{ username: "smoke-viewer", active: true }]],
    "GET /users?role=VIEWER&active=false": () => [200, []],
    "GET /auth/me": () => [200, { roles: ["VIEWER"] }],
    "GET /products": () => [200, []],
    "GET /customers": () => [403, {}],
  };
  const fetch = async (url, init) => {
    const path = url.slice(url.indexOf("/api/v1") + "/api/v1".length);
    const handler = routes[`${init.method} ${path}`];
    const [status, body] = handler(init.body === undefined ? undefined : JSON.parse(init.body));
    return { status, text: async () => JSON.stringify(body) };
  };
  return { gcloud, logins, run, fetch };
}

describe("bootstrapViewer", () => {
  test("entra como admin con la contraseña que recibe, sin leer ningún secreto de admin", async () => {
    const production = fakeProduction();
    await bootstrapViewer({
      projectId: "yacco-v2-prod",
      adminPassword: ADMIN_PASSWORD,
      baseUrl: "https://api.invalid",
      run: production.run,
      fetch: production.fetch,
      log: () => {},
    });
    assert.deepEqual(production.logins, ["admin", "smoke-viewer"]);
    assert.ok(production.gcloud.length > 0);
    for (const call of production.gcloud) assert.ok(!call.includes(ADMIN_SECRET), call);
  });

  test("después de rotar la contraseña del admin (F) sigue andando con la nueva", async () => {
    // El secreto de admin ya no sirve para nada: lo que vale es lo que la
    // persona escribe, y la API sólo acepta la vigente.
    const production = fakeProduction({ adminPassword: "la-rotada-en-F" });
    await bootstrapViewer({
      projectId: "yacco-v2-prod",
      adminPassword: "la-rotada-en-F",
      baseUrl: "https://api.invalid",
      run: production.run,
      fetch: production.fetch,
      log: () => {},
    });
    await assert.rejects(
      bootstrapViewer({
        projectId: "yacco-v2-prod",
        adminPassword: ADMIN_PASSWORD,
        baseUrl: "https://api.invalid",
        run: production.run,
        fetch: production.fetch,
        log: () => {},
      }),
      /login de admin devolvió 401/,
    );
  });
});

describe("el secreto de admin fuera de todo camino automático", () => {
  test("ningún workflow ni script lo nombra", () => {
    const files = [
      ...readdirSync(join(REPO_ROOT, ".github", "workflows")).map((name) =>
        join(REPO_ROOT, ".github", "workflows", name),
      ),
      ...readdirSync(join(REPO_ROOT, "scripts"))
        .filter((name) => name.endsWith(".mjs") && !name.endsWith(".test.mjs"))
        .map((name) => join(REPO_ROOT, "scripts", name)),
    ];
    const naming = files.filter((file) => readFileSync(file, "utf8").includes(ADMIN_SECRET));
    assert.deepEqual(naming, []);
  });
});
