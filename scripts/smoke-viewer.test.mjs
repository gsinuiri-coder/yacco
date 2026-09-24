/**
 * Tests de lo que decide `pnpm smoke:viewer` sin red: qué usuario crea y
 * cuándo lo da por existente.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { findViewer, viewerUserBody } from "./smoke-viewer.mjs";
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
