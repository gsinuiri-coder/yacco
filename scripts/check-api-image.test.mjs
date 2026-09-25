/**
 * Tests de lo que `check-api-image.mjs` acepta como etapa final de la imagen.
 * El chequeo contra la imagen real lo corre CI; acá, el criterio.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { apiImageProblems } from "./check-api-image.mjs";

const CLEAN = {
  bin: ["docker-entrypoint.sh", "node", "nodejs"],
  globalModules: [],
  opt: [],
  store: [
    "@nestjs+core@11.2.1",
    "@prisma+client@6.19.3_prisma@6.19.3_typescript@5.9.3",
    "lock.yaml",
  ],
};

describe("apiImageProblems", () => {
  test("una imagen con sólo node y el runtime pasa", () => {
    // El nombre de la entrada del cliente menciona prisma@ y typescript@
    // (son sus peers): no puede contar como el CLI ni como el compilador.
    assert.deepEqual(apiImageProblems(CLEAN), []);
  });

  test("la imagen base tal cual (npm, corepack, yarn) falla nombrándolos", () => {
    const problems = apiImageProblems({
      ...CLEAN,
      bin: [...CLEAN.bin, "npm", "npx", "corepack", "yarn"],
      globalModules: ["corepack", "npm"],
      opt: ["yarn-v1.22.22"],
    });
    assert.equal(problems.length, 3);
    assert.match(problems[0], /npm, npx, corepack, yarn/);
  });

  test("el CLI de Prisma y deepmerge-ts en el store fallan", () => {
    const problems = apiImageProblems({
      ...CLEAN,
      store: [...CLEAN.store, "prisma@6.19.3_typescript@5.9.3", "deepmerge-ts@7.1.5"],
    });
    assert.deepEqual(problems, [
      "node_modules/.pnpm trae prisma@6.19.3_typescript@5.9.3, deepmerge-ts@7.1.5",
    ]);
  });

  test("una poda que se lleva el cliente de Prisma falla", () => {
    assert.match(
      apiImageProblems({ ...CLEAN, store: ["@nestjs+core@11.2.1"] })[0],
      /NO trae @prisma\/client/,
    );
  });
});
