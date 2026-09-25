/**
 * Tests de lo que decide `pnpm smoke:viewer` sin red: qué usuario crea y
 * cuándo lo da por existente.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { classifySecretRead, findViewer, viewerPlan, viewerUserBody } from "./smoke-viewer.mjs";
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
