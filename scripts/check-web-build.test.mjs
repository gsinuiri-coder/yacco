import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildCommandArgs } from "./check-web-build.mjs";

describe("buildCommandArgs", () => {
  test("un comando pnpm devuelve sus argumentos, sin el programa", () => {
    assert.deepEqual(
      buildCommandArgs({ buildCommand: "pnpm --filter @yacco/web-nuxt build:vercel" }),
      ["--filter", "@yacco/web-nuxt", "build:vercel"],
    );
  });

  test("sin buildCommand falla: no hay nada que imitar de vercel build", () => {
    assert.throws(() => buildCommandArgs({}), /tiene que ser un comando pnpm/);
    assert.throws(() => buildCommandArgs({ buildCommand: "   " }), /tiene que ser un comando pnpm/);
  });

  test("un programa que no es pnpm falla", () => {
    assert.throws(
      () => buildCommandArgs({ buildCommand: "npm run build" }),
      /tiene que ser un comando pnpm/,
    );
  });

  test("una variable delante del comando falla: sin shell no se aplicaría", () => {
    // Justo la forma tentadora de fijar el preset, y la que en Windows no corre.
    assert.throws(
      () => buildCommandArgs({ buildCommand: "NITRO_PRESET=vercel pnpm build" }),
      /tiene que ser un comando pnpm/,
    );
  });

  test("sintaxis de shell en los argumentos falla", () => {
    assert.throws(
      () => buildCommandArgs({ buildCommand: "pnpm build && pnpm test" }),
      /no puede necesitar un shell/,
    );
  });
});
