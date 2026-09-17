import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { WIF_ATTRIBUTE_MAPPING, wifAttributeCondition } from "./wif-condition.mjs";

/**
 * Evalúa la condición contra los claims de un token, con la misma semántica
 * que usa: una conjunción de igualdades `assertion.<claim> == '<valor>'`. Si la
 * condición deja de tener esa forma, este parser falla, y es a propósito.
 */
function allows(condition, claims) {
  return condition.split(" && ").every((clause) => {
    const match = /^assertion\.(\w+) == '([^']*)'$/.exec(clause);
    assert.ok(match, `cláusula con forma inesperada: ${clause}`);
    return claims[match[1]] === match[2];
  });
}

// Los claims de un token real de la corrida de deploy sobre main.
const DEPLOY_ON_MAIN = {
  repository: "gsinuiri-coder/yacco",
  repository_id: "1339102029",
  repository_owner_id: "71910095",
  ref: "refs/heads/main",
  workflow_ref: "gsinuiri-coder/yacco/.github/workflows/deploy.yml@refs/heads/main",
};

describe("wifAttributeCondition", () => {
  const condition = wifAttributeCondition();

  test("deja pasar a deploy.yml corriendo sobre main", () => {
    assert.ok(allows(condition, DEPLOY_ON_MAIN));
  });

  test("rechaza otro workflow del mismo repo y la misma rama", () => {
    const ci = {
      ...DEPLOY_ON_MAIN,
      workflow_ref: "gsinuiri-coder/yacco/.github/workflows/ci.yml@refs/heads/main",
    };
    assert.equal(allows(condition, ci), false);
  });

  test("rechaza deploy.yml desde otra rama", () => {
    const branch = {
      ...DEPLOY_ON_MAIN,
      ref: "refs/heads/feature",
      workflow_ref: "gsinuiri-coder/yacco/.github/workflows/deploy.yml@refs/heads/feature",
    };
    assert.equal(allows(condition, branch), false);
  });

  test("rechaza un repo con el mismo nombre y otro id (renombrado y reclamado)", () => {
    const squatter = { ...DEPLOY_ON_MAIN, repository_id: "999", repository_owner_id: "888" };
    assert.equal(allows(condition, squatter), false);
  });

  test("el mapeo expone los claims que la condición usa como atributos", () => {
    for (const claim of ["repository", "repository_id", "ref", "workflow_ref"]) {
      assert.match(
        WIF_ATTRIBUTE_MAPPING,
        new RegExp(`attribute[.]${claim}=assertion[.]${claim}(,|$)`),
      );
    }
  });
});
