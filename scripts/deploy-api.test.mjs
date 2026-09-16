/**
 * Tests de lo que `scripts/deploy-api.mjs` decide antes de llamar a ningún
 * CLI: qué subcomando se pidió, y que una imagen sólo se despliega con el
 * commit del que salió.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  ENVIRONMENTS,
  assertImageMatchesCommit,
  imageRepository,
  imageTagFor,
  parseArgs,
} from "./deploy-api.mjs";
import { VERCEL_ORG_ID, VERCEL_PROJECT_ID, vercelSteps } from "./deploy-web.mjs";

const SHA = "6a7e33e1acd8b7655b07b64f2d6881d59cfa5106";
const REPO = imageRepository("us-east4", "yacco-v2-prod");

describe("parseArgs", () => {
  test("sin subcomando ni flag: build + deploy a DEMO, nunca a producción", () => {
    assert.deepEqual(parseArgs([]), { command: "all", envName: "demo", image: undefined });
  });

  test("producción hay que escribirla", () => {
    assert.equal(parseArgs(["--env=production"]).envName, "production");
  });

  test("build no necesita entorno", () => {
    assert.equal(parseArgs(["build"]).command, "build");
  });

  test("deploy sin --image es un error, no un build escondido", () => {
    assert.match(parseArgs(["deploy", "--env=demo"]).error, /--image/);
  });

  test("deploy con imagen", () => {
    const image = `${REPO}:${imageTagFor(SHA)}`;
    assert.deepEqual(parseArgs(["deploy", "--env=production", `--image=${image}`]), {
      command: "deploy",
      envName: "production",
      image,
    });
  });

  test("un entorno desconocido es un error", () => {
    assert.match(parseArgs(["--env=staging"]).error, /staging/);
  });

  test("un subcomando desconocido es un error", () => {
    assert.match(parseArgs(["rollback"]).error, /rollback/);
  });
});

describe("assertImageMatchesCommit", () => {
  test("la imagen del commit pasa", () => {
    assert.doesNotThrow(() => assertImageMatchesCommit(`${REPO}:${imageTagFor(SHA)}`, SHA));
  });

  test("la etiqueta del entorno NO pasa: nunca se despliega lo cacheado como :production", () => {
    assert.throws(() => assertImageMatchesCommit(`${REPO}:production`, SHA), /no es la del commit/);
  });

  test("la imagen de otro commit no pasa", () => {
    const other = "0123456789abcdef0123456789abcdef01234567";
    assert.throws(() => assertImageMatchesCommit(`${REPO}:${imageTagFor(other)}`, SHA));
  });
});

describe("ENVIRONMENTS", () => {
  test("demo no lista ningún origen de Vercel; producción sólo el alias estable (D-013)", () => {
    assert.doesNotMatch(ENVIRONMENTS.demo.webOriginDefault, /vercel/);
    assert.equal(
      ENVIRONMENTS.production.webOriginDefault,
      "https://yacco-web.vercel.app,http://localhost:5173",
    );
  });
});

describe("vercelSteps", () => {
  test("producción: pull de production, build --prod, deploy --prebuilt --prod", () => {
    assert.deepEqual(vercelSteps({ preview: false }), [
      ["pull", "--yes", "--environment=production"],
      ["build", "--prod"],
      ["deploy", "--prebuilt", "--prod"],
    ]);
  });

  test("preview: nada lleva --prod", () => {
    const steps = vercelSteps({ preview: true });
    assert.ok(steps.every((args) => !args.includes("--prod")));
    assert.deepEqual(steps[0], ["pull", "--yes", "--environment=preview"]);
  });

  test("ningún paso pasa el token por argv", () => {
    for (const args of [...vercelSteps({ preview: false }), ...vercelSteps({ preview: true })]) {
      assert.ok(args.every((arg) => !arg.startsWith("--token") && arg !== "-t"));
    }
  });

  test("los ids de Vercel tienen la forma de un id, no de un nombre", () => {
    assert.match(VERCEL_ORG_ID, /^team_/);
    assert.match(VERCEL_PROJECT_ID, /^prj_/);
  });
});
