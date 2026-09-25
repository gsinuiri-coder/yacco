/**
 * Tests de `deploy-scope.mjs` sin red: qué cuenta como documentación y cuándo
 * se despliega igual por las dudas.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { classifyChange, deployScope, isDocsOnlyPath, productionCommit } from "./deploy-scope.mjs";

describe("isDocsOnlyPath", () => {
  test("docs, cualquier markdown y las reglas de los agentes son documentación", () => {
    for (const path of [
      "docs/PROGRESO.md",
      "docs/img/diagrama.png",
      "AGENTS.md",
      "apps/api/README.md",
      ".agents/rules/infra.md",
      ".claude/skills/demo-seed/SKILL.md",
    ]) {
      assert.equal(isDocsOnlyPath(path), true, path);
    }
  });

  test("código, workflows, scripts y dependencias no lo son", () => {
    for (const path of [
      "apps/api/src/main.ts",
      "apps/web-nuxt/app/pages/index.vue",
      ".github/workflows/deploy.yml",
      "scripts/smoke.mjs",
      "pnpm-lock.yaml",
      "apps/api/prisma/schema.prisma",
      "apps/api/Dockerfile",
    ]) {
      assert.equal(isDocsOnlyPath(path), false, path);
    }
  });
});

describe("classifyChange", () => {
  test("todo documentación: docs-only", () => {
    assert.equal(classifyChange(["docs/a.md", "AGENTS.md"]), "docs-only");
  });

  test("un solo archivo que corre alcanza para desplegar", () => {
    assert.equal(classifyChange(["docs/a.md", "apps/api/src/main.ts"]), "runtime");
  });

  test("sin archivos no se afirma nada: runtime", () => {
    assert.equal(classifyChange([]), "runtime");
  });
});

describe("deployScope", () => {
  const ahead = (files) => async () => ({ status: "ahead", files });

  test("compara contra lo que está en producción, no contra el commit anterior", async () => {
    const calls = [];
    const compare = async (base, head) => {
      calls.push([base, head]);
      return { status: "ahead", files: ["docs/a.md"] };
    };
    const result = await deployScope({ sha: "new", deployedCommit: "prod", compare });
    assert.equal(result.scope, "docs-only");
    assert.deepEqual(calls, [["prod", "new"]]);
  });

  test("documentación después de un cambio de código sin desplegar: se despliega", async () => {
    const result = await deployScope({
      sha: "new",
      deployedCommit: "prod",
      compare: ahead(["apps/api/src/main.ts", "docs/a.md"]),
    });
    assert.equal(result.scope, "runtime");
  });

  test("sin commit desplegado conocido, se despliega", async () => {
    // La comparación diría «todo documentación»: lo que decide es no saber qué corre.
    const result = await deployScope({
      sha: "new",
      deployedCommit: null,
      compare: ahead(["docs/a.md"]),
    });
    assert.equal(result.scope, "runtime");
  });

  test("si la comparación falla, se despliega", async () => {
    const compare = async () => {
      throw new Error("gh caído");
    };
    const result = await deployScope({ sha: "new", deployedCommit: "prod", compare });
    assert.equal(result.scope, "runtime");
  });

  test("si lo desplegado no es un ancestro, se despliega", async () => {
    const compare = async () => ({ status: "diverged", files: ["docs/a.md"] });
    const result = await deployScope({ sha: "new", deployedCommit: "prod", compare });
    assert.equal(result.scope, "runtime");
  });

  test("con la lista de archivos cortada (300), se despliega", async () => {
    const files = Array.from({ length: 300 }, (_, index) => `docs/${index}.md`);
    const result = await deployScope({ sha: "new", deployedCommit: "prod", compare: ahead(files) });
    assert.equal(result.scope, "runtime");
  });

  test("relanzar sobre el commit que ya corre en producción despliega igual (el web o el smoke pudieron fallar)", async () => {
    const compare = async () => ({ status: "identical", files: [] });
    const result = await deployScope({ sha: "same", deployedCommit: "same", compare });
    assert.equal(result.scope, "runtime");
  });
});

describe("productionCommit", () => {
  test("lee el commit de /health", async () => {
    const fetch = async () => ({ ok: true, json: async () => ({ commit: "abc" }) });
    assert.equal(await productionCommit(fetch), "abc");
  });

  test("un /health caído o sin commit es null, nunca un error", async () => {
    assert.equal(await productionCommit(async () => ({ ok: false })), null);
    assert.equal(
      await productionCommit(async () => ({ ok: true, json: async () => ({ commit: "" }) })),
      null,
    );
    assert.equal(
      await productionCommit(async () => {
        throw new Error("red");
      }),
      null,
    );
  });
});
