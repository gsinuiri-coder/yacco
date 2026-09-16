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
  deployCommands,
  gcloudDictFlag,
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

describe("deployCommands", () => {
  const params = (envName) => ({
    projectId: "yacco-v2-prod",
    region: "us-east4",
    config: {},
    envName,
    imageRef: `${REPO}:${imageTagFor(SHA)}`,
    commit: SHA,
  });

  for (const envName of ["demo", "production"]) {
    test(`${envName}: ningún comando toca etiquetas de Artifact Registry`, () => {
      // Mover una etiqueta existente exige artifactregistry.tags.delete, que el
      // deployer no tiene por diseño: el primer deploy desde CI falló por eso.
      // Y la etiqueta de entorno no la usaba nadie (D-014).
      for (const args of deployCommands(params(envName))) {
        assert.ok(!args.includes("tags"), `comando con etiquetas: gcloud ${args.join(" ")}`);
        assert.notEqual(
          args[0],
          "artifacts",
          `comando de Artifact Registry: gcloud ${args.join(" ")}`,
        );
      }
    });
  }

  test("el único comando es gcloud run deploy, con la imagen del sha", () => {
    const commands = deployCommands(params("production"));
    assert.equal(commands.length, 1);
    const [deploy] = commands;
    assert.deepEqual(deploy.slice(0, 3), ["run", "deploy", "yacco-api"]);
    assert.ok(deploy.includes(`--image=${REPO}:${imageTagFor(SHA)}`));
  });

  test("el deploy pasa el commit y el APP_ENV del entorno", () => {
    const [deploy] = deployCommands(params("demo"));
    const envVars = deploy.find((arg) => arg.startsWith("--set-env-vars="));
    assert.match(envVars, new RegExp(`DEPLOYED_COMMIT=${SHA}`));
    assert.match(envVars, /APP_ENV=demo/);
  });
});

/**
 * Cómo parsea gcloud un flag de diccionario, según `gcloud topic escaping`:
 * si el valor empieza con ^DELIM^, los pares se separan por DELIM; si no, por
 * coma. Cada par se parte en el PRIMER "=". Un par sin "=" es un error de
 * sintaxis, que es exactamente lo que devolvió gcloud en el deploy que falló.
 */
function parseGcloudDict(value) {
  let body = value;
  let delimiter = ",";
  const escaped = /^\^([^^]+)\^/.exec(value);
  if (escaped !== null) {
    delimiter = escaped[1];
    body = value.slice(escaped[0].length);
  }
  const dict = {};
  for (const item of body.split(delimiter)) {
    const at = item.indexOf("=");
    if (at < 0) throw new Error(`Bad syntax for dict arg: [${item}]`);
    dict[item.slice(0, at)] = item.slice(at + 1);
  }
  return dict;
}

describe("flags de diccionario de gcloud", () => {
  const flagValue = (envName, flag, config = {}) => {
    const [deploy] = deployCommands({
      projectId: "yacco-v2-prod",
      region: "us-east4",
      config,
      envName,
      imageRef: `${REPO}:${imageTagFor(SHA)}`,
      commit: SHA,
    });
    return deploy.find((arg) => arg.startsWith(`${flag}=`)).slice(flag.length + 1);
  };

  test("un WEB_ORIGIN con coma llega ENTERO a gcloud", () => {
    // El caso que rompió el segundo deploy desde CI (#136): el valor tiene una
    // coma y gcloud la tomaba como separador de variables.
    //
    // VALOR SINTÉTICO, a propósito y por ahora. Hasta el PR que sacó
    // localhost:5173 de producción, esto usaba el WEB_ORIGIN real de
    // producción, que tenía coma. Hoy ningún valor desplegado la tiene, así
    // que se pasa por config. Cuando se agregue el dominio propio, el valor
    // real vuelve a tener coma: volver a usar ESE valor acá, sin config.
    const origins = "https://yacco-web.vercel.app,https://dominio-propio.example";
    const env = parseGcloudDict(flagValue("production", "--set-env-vars", { WEB_ORIGIN: origins }));
    assert.equal(env.WEB_ORIGIN, origins);
    assert.equal(env.APP_ENV, "production");
    assert.equal(env.DEPLOYED_COMMIT, SHA);
  });

  test("producción: WEB_ORIGIN es sólo el alias de Vercel, sin localhost", () => {
    const env = parseGcloudDict(flagValue("production", "--set-env-vars"));
    assert.equal(env.WEB_ORIGIN, "https://yacco-web.vercel.app");
  });

  test("demo: las mismas variables, parseadas por gcloud", () => {
    const env = parseGcloudDict(flagValue("demo", "--set-env-vars"));
    assert.equal(env.WEB_ORIGIN, "http://localhost:5173");
    assert.equal(env.APP_ENV, "demo");
  });

  test("los cuatro secretos llegan por referencia, cada uno a su nombre", () => {
    const secrets = parseGcloudDict(flagValue("production", "--set-secrets"));
    assert.deepEqual(secrets, {
      DATABASE_URL: "yacco-production-database-url:latest",
      DIRECT_URL: "yacco-production-direct-url:latest",
      JWT_ACCESS_SECRET: "yacco-production-jwt-access-secret:latest",
      JWT_REFRESH_SECRET: "yacco-production-jwt-refresh-secret:latest",
    });
  });

  test("un valor que contiene el separador frena, en vez de partirse en silencio", () => {
    assert.throws(() => gcloudDictFlag(["WEB_ORIGIN=a@@b"]), /separador/);
  });
});

describe("ENVIRONMENTS", () => {
  test("demo no lista ningún origen de Vercel; producción sólo el alias estable (D-013)", () => {
    assert.doesNotMatch(ENVIRONMENTS.demo.webOriginDefault, /vercel/);
    assert.equal(ENVIRONMENTS.production.webOriginDefault, "https://yacco-web.vercel.app");
  });

  test("producción no acepta ningún origen local", () => {
    // 5173 es el puerto por defecto de CUALQUIER proyecto Vite: aceptarlo en
    // la API real, con credenciales, abre la puerta a cualquier proyecto
    // levantado en ese puerto.
    assert.doesNotMatch(ENVIRONMENTS.production.webOriginDefault, /localhost|127\.0\.0\.1/);
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
