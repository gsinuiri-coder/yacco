/**
 * Tests de qué acepta subir `pnpm secrets:gcp` desde la configuración.
 *
 * El caso que importa es el de los JWT: subirlos desde .env.setup rota los
 * secretos de producción y los deja iguales a los de local. La protección no
 * puede depender de que quien corre el script lo sepa: tiene que fallar solo.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ENV_SETUP_PATH } from "./lib.mjs";
import {
  NEVER_UPLOADED_FROM_CONFIG,
  UPLOADABLE_FROM_CONFIG,
  checkUploadsHaveValue,
  parseArgs,
} from "./secrets-gcp.mjs";

describe("parseArgs de secrets:gcp", () => {
  test("sin flags no sube NADA desde la configuración", () => {
    assert.deepEqual(parseArgs([]), { upload: [], envFile: ENV_SETUP_PATH });
  });

  test("--upload=VERCEL_TOKEN es lo único que se acepta hoy", () => {
    assert.deepEqual(parseArgs(["--upload=VERCEL_TOKEN"]).upload, ["VERCEL_TOKEN"]);
  });

  test("JWT_ACCESS_SECRET se rechaza, diciendo que rota producción", () => {
    const { error } = parseArgs(["--upload=JWT_ACCESS_SECRET"]);
    assert.match(error, /JWT_ACCESS_SECRET/);
    assert.match(error, /rota el secreto de producción/);
  });

  test("JWT_REFRESH_SECRET se rechaza aunque venga junto a una clave válida", () => {
    // Las dos claves a propósito: una lista que valida sólo la primera dejaría
    // pasar a la segunda.
    const { error } = parseArgs(["--upload=VERCEL_TOKEN,JWT_REFRESH_SECRET"]);
    assert.match(error, /JWT_REFRESH_SECRET/);
  });

  test("una clave que no está en la lista falla, aunque no sea un JWT", () => {
    const { error } = parseArgs(["--upload=NEON_API_KEY"]);
    assert.match(error, /no está en la lista/);
  });

  test("un argumento desconocido falla, en vez de ignorarse", () => {
    assert.match(parseArgs(["--all"]).error, /desconocido/);
  });

  test("--env-file cambia de dónde se lee la configuración", () => {
    assert.equal(parseArgs(["--env-file=C:/otra/.env.setup"]).envFile, "C:/otra/.env.setup");
  });
});

describe("las listas", () => {
  test("ninguna clave está a la vez en las dos listas", () => {
    for (const key of Object.keys(NEVER_UPLOADED_FROM_CONFIG)) {
      assert.equal(Object.hasOwn(UPLOADABLE_FROM_CONFIG, key), false, key);
    }
  });

  test("el token de Vercel va al secreto que lee CI", () => {
    assert.deepEqual(UPLOADABLE_FROM_CONFIG, { VERCEL_TOKEN: "yacco-ci-vercel-token" });
  });
});

describe("checkUploadsHaveValue", () => {
  // Un secreto vacío subido a Secret Manager EXISTE: pasa el preflight del
  // deploy, que sólo mira presencia, y revienta recién en el job de Vercel.
  test("VERCEL_TOKEN presente pero VACÍO falla, nombrando la clave", () => {
    const error = checkUploadsHaveValue({ VERCEL_TOKEN: "" }, ["VERCEL_TOKEN"]);
    assert.match(error, /VERCEL_TOKEN/);
    assert.match(error, /vacío/);
    assert.match(error, /No se subió nada/);
  });

  test("sólo espacios cuenta como vacío", () => {
    assert.match(checkUploadsHaveValue({ VERCEL_TOKEN: "   " }, ["VERCEL_TOKEN"]), /VERCEL_TOKEN/);
  });

  test("la clave ausente también falla", () => {
    assert.match(checkUploadsHaveValue({}, ["VERCEL_TOKEN"]), /VERCEL_TOKEN/);
  });

  test("con valor, no hay error", () => {
    assert.equal(
      checkUploadsHaveValue({ VERCEL_TOKEN: "un-token-de-prueba" }, ["VERCEL_TOKEN"]),
      null,
    );
  });

  test("sin nada pedido, un VERCEL_TOKEN vacío no importa: no se va a subir", () => {
    assert.equal(checkUploadsHaveValue({ VERCEL_TOKEN: "" }, []), null);
  });
});
