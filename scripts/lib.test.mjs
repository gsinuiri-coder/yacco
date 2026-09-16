/**
 * Tests de `scripts/lib.mjs`, con el runner de Node (`node --test`): estos
 * scripts corren fuera de toda app, así que no los alcanza ni Jest (apps/api)
 * ni Vitest (apps/web), y `node:test` viene con la plataforma — no agrega
 * ninguna dependencia.
 *
 * Lo que se prueba acá es sobre todo el TACHADO de secretos. Es un control de
 * seguridad: si deja de funcionar, nada falla ruidosamente, simplemente
 * empiezan a aparecer credenciales en logs y en mensajes de error.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import {
  CommandError,
  isSecretKey,
  loadConfig,
  readEnvFile,
  redact,
  registerSecret,
  run,
} from "./lib.mjs";

const workdir = mkdtempSync(join(tmpdir(), "yacco-lib-test-"));
after(() => rmSync(workdir, { recursive: true, force: true }));

let fileCounter = 0;
function envFileWith(contents) {
  const path = join(workdir, `env-${(fileCounter += 1)}`);
  writeFileSync(path, contents, "utf8");
  return path;
}

describe("readEnvFile", () => {
  test("parsea las formas que aparecen en un .env real", () => {
    const path = envFileWith(
      [
        "# un comentario",
        "",
        "GCP_REGION=us-east4",
        "export NEON_ORG_ID=org-still-lake",
        'QUOTED_DOUBLE="con espacios"',
        "QUOTED_SINGLE='otro valor'",
        "WITH_TRAILING_COMMENT=valor   # esto no es parte del valor",
        "  SPACED   =   trimmed  ",
      ].join("\n"),
    );

    assert.deepEqual(readEnvFile(path), {
      GCP_REGION: "us-east4",
      NEON_ORG_ID: "org-still-lake",
      QUOTED_DOUBLE: "con espacios",
      QUOTED_SINGLE: "otro valor",
      WITH_TRAILING_COMMENT: "valor",
      SPACED: "trimmed",
    });
  });

  test("un archivo inexistente da {} en vez de reventar", () => {
    // Es lo que deja a `env:check` decir "todavía no hay nada" en vez de
    // morirse, y lo que deja correr los scripts en CI, donde no hay archivo.
    assert.deepEqual(readEnvFile(join(workdir, "no-existe")), {});
  });

  test("un valor con `=` adentro se conserva entero", () => {
    // Una connection string de Postgres trae `?sslmode=require`: partir por el
    // primer `=` está bien, partir por todos la rompe.
    const path = envFileWith("DATABASE_URL=postgresql://u:p@host/db?sslmode=require");
    assert.equal(readEnvFile(path).DATABASE_URL, "postgresql://u:p@host/db?sslmode=require");
  });
});

describe("isSecretKey", () => {
  test("reconoce las connection strings, que no se llaman como un secreto", () => {
    // El caso que motiva la regla: DATABASE_URL y DIRECT_URL llevan la
    // contraseña del rol adentro y no dicen SECRET, TOKEN ni PASSWORD.
    assert.equal(isSecretKey("DATABASE_URL"), true);
    assert.equal(isSecretKey("DIRECT_URL"), true);
  });

  test("reconoce las formas obvias", () => {
    for (const key of ["JWT_ACCESS_SECRET", "VERCEL_TOKEN", "NEON_API_KEY", "ADMIN_PASSWORD"]) {
      assert.equal(isSecretKey(key), true, `${key} debería ser secreta`);
    }
  });

  test("no marca como secreta una clave que no lo es", () => {
    for (const key of ["GCP_REGION", "GCP_PROJECT_ID", "NEON_ORG_ID", "PORT"]) {
      assert.equal(isSecretKey(key), false, `${key} no debería ser secreta`);
    }
  });
});

describe("redact", () => {
  test("tacha un valor leído de un .env aunque aparezca dentro de otro texto", () => {
    // El escenario real: gcloud falla y te devuelve la connection string
    // citada dentro de su propio mensaje de error. El tachado es por VALOR,
    // así que lo agarra igual.
    const path = envFileWith("DATABASE_URL=postgresql://yacco:s3cr3t-larguisimo@host/db");
    readEnvFile(path);

    const mensaje = redact(
      "falló al conectar a postgresql://yacco:s3cr3t-larguisimo@host/db (timeout)",
    );

    assert.equal(mensaje, "falló al conectar a *** (timeout)");
    assert.ok(!mensaje.includes("s3cr3t-larguisimo"));
  });

  test("no tacha valores cortos, que convertirían el tachado en un comodín", () => {
    // Un secreto de 3 caracteres no existe; tratarlo como tal destrozaría
    // cualquier salida que contenga esa subcadena por casualidad.
    registerSecret("abc");
    assert.equal(redact("abcdefg abc"), "abcdefg abc");
  });

  test("deja intacto un texto sin secretos", () => {
    assert.equal(redact("desplegado en us-east4"), "desplegado en us-east4");
  });
});

describe("loadConfig", () => {
  test("el entorno del proceso pisa el valor del archivo", () => {
    // Los dos valores son DISTINTOS a propósito: con el mismo valor en los dos
    // lados, el test pasaría aunque la precedencia estuviera al revés.
    const path = envFileWith("GCP_REGION=del-archivo");
    const previo = process.env.GCP_REGION;
    process.env.GCP_REGION = "del-entorno";
    try {
      assert.equal(loadConfig(path).GCP_REGION, "del-entorno");
    } finally {
      if (previo === undefined) delete process.env.GCP_REGION;
      else process.env.GCP_REGION = previo;
    }
  });

  test("una variable de entorno VACÍA no pisa el valor del archivo", () => {
    // Exportar una variable en blanco es tan fácil como no exportarla, y en CI
    // pasa solo: un secreto no configurado llega como "". Si eso ganara, el
    // script se quedaría sin valor teniendo uno bueno en el archivo.
    const path = envFileWith("GCP_REGION=del-archivo");
    const previo = process.env.GCP_REGION;
    process.env.GCP_REGION = "";
    try {
      assert.equal(loadConfig(path).GCP_REGION, "del-archivo");
    } finally {
      if (previo === undefined) delete process.env.GCP_REGION;
      else process.env.GCP_REGION = previo;
    }
  });
});

describe("CommandError", () => {
  test("no incluye los argumentos del comando", () => {
    // La razón de ser de la clase: un `--token=...` en argv no puede volver a
    // aparecer en el mensaje de error.
    const error = new CommandError("gcloud", 1, "PERMISSION_DENIED");
    assert.ok(error.message.includes("gcloud"));
    assert.ok(error.message.includes("PERMISSION_DENIED"));
    assert.ok(!error.message.includes("--"));
  });

  test("tacha un secreto que venga en el stderr del comando", () => {
    registerSecret("token-secretisimo-largo");
    const error = new CommandError("vercel", 1, "bad credentials: token-secretisimo-largo");
    assert.ok(!error.message.includes("token-secretisimo-largo"));
    assert.ok(error.message.includes("***"));
  });

  test("dice algo útil aunque el comando no escriba nada en stderr", () => {
    const error = new CommandError("gh", 2, "");
    assert.match(error.message, /exit 2/);
  });
});

describe("run", () => {
  test("devuelve el stdout del proceso hijo", () => {
    assert.equal(run("node", ["-e", "process.stdout.write('hola')"]), "hola");
  });

  test("pasa las credenciales por env, no por argv", () => {
    // Así es como viaja un token: el hijo lo lee del entorno. Nunca aparece en
    // la lista de argumentos, que es visible en `ps`.
    const salida = run("node", ["-e", "process.stdout.write(process.env.YACCO_TEST_TOKEN)"], {
      env: { YACCO_TEST_TOKEN: "valor-de-prueba-largo" },
    });
    assert.equal(salida, "valor-de-prueba-largo");
  });

  test("lanza CommandError cuando el proceso falla", () => {
    assert.throws(() => run("node", ["-e", "process.exit(3)"]), { name: "CommandError" });
  });

  test("con allowFailure devuelve el resultado en vez de lanzar", () => {
    // Es el modo que usan los chequeos de idempotencia: "¿este recurso ya
    // existe?" se responde con un comando que falla, y fallar no es un error.
    const resultado = run("node", ["-e", "process.exit(3)"], { allowFailure: true });
    assert.equal(resultado.ok, false);
    assert.equal(resultado.status, 3);
  });

  test("quiet registra el stdout para que no se filtre más tarde", () => {
    // `neonctl connection-string` imprime la credencial al SALIR BIEN. Después
    // de leerla con quiet, un error posterior no puede repetirla.
    const secreto = "postgresql://u:clave-larguisima@host/db";
    run("node", ["-e", `process.stdout.write(${JSON.stringify(secreto)})`], { quiet: true });
    assert.ok(!redact(`falló usando ${secreto}`).includes("clave-larguisima"));
  });

  test("un ejecutable inexistente falla con un mensaje que lo nombra", () => {
    assert.throws(() => run("comando-que-no-existe-jamas", []), /comando-que-no-existe-jamas/);
  });
});
