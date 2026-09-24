/**
 * `pnpm secrets:gcp` — sube a Secret Manager lo que Cloud Run necesita, para
 * producción y para demo, y concede al deployer de CI lectura sobre los
 * secretos que usa, uno por uno. Idempotente.
 *
 *   pnpm secrets:gcp                             URLs de Neon; JWT desde Secret Manager
 *   pnpm secrets:gcp --upload=VERCEL_TOKEN       además, sube el token de Vercel
 *   pnpm secrets:gcp --env-file=<ruta> ...       lee la configuración de otro archivo
 *   pnpm secrets:gcp --check                     sólo valida: no escribe NADA
 *
 * `--check` es el primer paso de toda rotación de una credencial de Neon
 * (D-017): valida la configuración y que los ids de GCP y de Neon abren lo que
 * tienen que abrir, ANTES de un reset que no tiene vuelta atrás. No crea
 * secretos, versiones ni permisos, y no lee el valor de ningún secreto: sólo
 * sus metadatos.
 *
 * Qué valores salen de la CONFIGURACIÓN (.env.setup o el entorno) y van a
 * Secret Manager es una lista EXPLÍCITA y cerrada: UPLOADABLE_FROM_CONFIG, y
 * de esa lista sólo lo que se pide con --upload. Pedir cualquier otra clave
 * hace fallar el script antes de tocar nada. Ver NEVER_UPLOADED_FROM_CONFIG.
 *
 * Ningún valor se imprime, ni al subirlo ni al compararlo. Los valores viajan
 * a `gcloud` por STDIN, nunca por argv: un argumento es visible en `ps` y
 * queda en el historial del shell. Las connection strings se piden a `neonctl`
 * con `quiet: true`, porque ese comando imprime la credencial al salir bien.
 *
 * Sólo se crea una versión nueva del secreto si el valor CAMBIÓ. Sin esa
 * comparación, cada corrida acumularía una versión idéntica más, y el
 * historial dejaría de servir para ver cuándo cambió algo de verdad.
 */
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  ENV_SETUP_PATH,
  RUNTIME_SERVICE_ACCOUNTS,
  loadConfig,
  registerSecret,
  run,
} from "./lib.mjs";

// Mismo tamaño que `pnpm secrets:generate`: 48 bytes, holgadamente por encima
// de los 256 bits que pide HS256, que es lo que firma @nestjs/jwt acá.
const SECRET_BYTES = 48;

/**
 * Qué rama de Neon alimenta a qué servicio.
 *
 * El sentido es UNA sola dirección: `main` puede refrescar `demo`, y nada de
 * lo que se escribe en `demo` vuelve a `main`.
 */
const ENVIRONMENTS = [
  { name: "production", neonBranch: "main" },
  { name: "demo", neonBranch: "demo" },
];

// La service account con la que despliega GitHub Actions (gcp-bootstrap.mjs).
const DEPLOYER_SERVICE_ACCOUNT = "yacco-deployer";

// Los ÚNICOS secretos que CI lee (D-014, D-015). Se conceden uno por uno, sobre
// el secreto y no sobre el proyecto: el deployer puede leer la URL directa de
// cada rama —para migrar— y el token de Vercel, y ningún otro. Nunca las URLs
// pooled ni los JWT, que son del runtime y el que despliega no necesita.
const DEPLOYER_READABLE_KEYS = ["direct-url"];
const CI_VERCEL_TOKEN_SECRET = "yacco-ci-vercel-token";

/**
 * Las ÚNICAS claves cuyo VALOR se toma de la configuración y se sube a Secret
 * Manager, y a qué secreto va cada una. Se suben sólo si se piden con
 * `--upload`: correr el script sin ese flag no sube nada que venga de
 * .env.setup.
 *
 * El token de Vercel está acá porque nace fuera de todo sistema —lo crea una
 * persona en el dashboard— y .env.setup es por donde entra (D-015).
 */
export const UPLOADABLE_FROM_CONFIG = {
  VERCEL_TOKEN: CI_VERCEL_TOKEN_SECRET,
};

/**
 * Claves que NUNCA se suben desde la configuración, con el motivo que se le
 * muestra a quien lo intente.
 *
 * Los JWT_* de .env.setup son los del entorno LOCAL (los escribe
 * `pnpm secrets:generate`). Subirlos desde ahí ROTA los secretos de producción
 * —versión nueva, todas las sesiones abiertas invalidadas— y además los deja
 * IGUALES a los de local, que es justo lo que D-007 separa. Los de producción
 * viven sólo en Secret Manager: se leen de ahí, o nacen ahí al azar si no
 * existen. Hasta el 2026-09-16 este script tomaba los JWT de la configuración
 * cuando estaban; bastaba correrlo desde una máquina con un .env.setup
 * completo para rotarlos sin querer.
 */
export const NEVER_UPLOADED_FROM_CONFIG = {
  JWT_ACCESS_SECRET:
    "rota el secreto de producción (invalida todas las sesiones) y lo deja igual al de local",
  JWT_REFRESH_SECRET:
    "rota el secreto de producción (invalida todas las sesiones) y lo deja igual al de local",
};

/**
 * Lee `--upload` y `--env-file`. Devuelve `{ error }` en vez de salir del
 * proceso, para poder probarlo.
 */
export function parseArgs(argv) {
  const unknown = argv.filter(
    (argument) =>
      argument !== "--check" &&
      !argument.startsWith("--upload=") &&
      !argument.startsWith("--env-file="),
  );
  if (unknown.length > 0) {
    return { error: `Argumento desconocido: ${unknown.join(" ")}` };
  }

  const flag = (name) => {
    const found = argv.find((argument) => argument.startsWith(`--${name}=`));
    return found === undefined ? undefined : found.slice(`--${name}=`.length);
  };

  const upload = (flag("upload") ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter((key) => key.length > 0);

  for (const key of upload) {
    if (Object.hasOwn(NEVER_UPLOADED_FROM_CONFIG, key)) {
      return {
        error: `${key} no se sube desde la configuración: ${NEVER_UPLOADED_FROM_CONFIG[key]}. Ver D-007.`,
      };
    }
    if (!Object.hasOwn(UPLOADABLE_FROM_CONFIG, key)) {
      return {
        error:
          `${key} no está en la lista de claves que se suben desde la configuración ` +
          `(${Object.keys(UPLOADABLE_FROM_CONFIG).join(", ")}).`,
      };
    }
  }

  const envFile = flag("env-file") ?? ENV_SETUP_PATH;
  if (envFile.length === 0) return { error: "--env-file vacío." };

  return { upload, envFile, check: argv.includes("--check") };
}

/**
 * Lo pedido con --upload tiene que tener valor, y se comprueba ANTES de tocar
 * ningún secreto. Devuelve el error, o null.
 *
 * Un valor vacío (o sólo espacios) no se sube nunca. Si se subiera, el secreto
 * EXISTIRÍA en Secret Manager: pasaría el preflight del deploy, que sólo mira
 * que el secreto esté (D-015), y el deploy reventaría recién en el job de
 * Vercel, después de migrar las bases y desplegar las APIs. Acá falla en el
 * momento, diciendo qué clave está vacía.
 */
export function checkUploadsHaveValue(config, upload) {
  const empty = upload.filter((key) => (config[key] ?? "").trim().length === 0);
  if (empty.length === 0) return null;
  return (
    `--upload pide ${empty.join(", ")}, pero está vacío en la configuración ` +
    "(o no está). No se subió nada."
  );
}

function secretName(environment, key) {
  return `yacco-${environment}-${key}`;
}

/** Los argumentos de gcloud para que `account` lea ESTE secreto. Idempotente. */
function accessorBinding(projectId, name, account) {
  return [
    "secrets",
    "add-iam-policy-binding",
    name,
    `--project=${projectId}`,
    `--member=serviceAccount:${account}@${projectId}.iam.gserviceaccount.com`,
    "--role=roles/secretmanager.secretAccessor",
    "--condition=None",
  ];
}

/** Deja que el deployer lea ESTE secreto, y nada más. */
function grantDeployerAccess(projectId, name, report) {
  run("gcloud", accessorBinding(projectId, name, DEPLOYER_SERVICE_ACCOUNT));
  report.push(`  ${name.padEnd(38)} legible por el deployer de CI`);
}

/**
 * A4: cada identidad de runtime lee los secretos de SU entorno y ninguno
 * más, uno por uno. Antes, `yacco-api-run` tenía `secretAccessor` sobre todo
 * el proyecto y la usaban los dos servicios.
 */
export function runtimeAccessBindings(projectId) {
  return ENVIRONMENTS.flatMap((environment) =>
    RUNTIME_KEYS.map((key) =>
      accessorBinding(
        projectId,
        secretName(environment.name, key),
        RUNTIME_SERVICE_ACCOUNTS[environment.name],
      ),
    ),
  );
}

/** Devuelve el valor actual del secreto, o null si no existe todavía. */
function currentValue(projectId, name) {
  const result = run(
    "gcloud",
    ["secrets", "versions", "access", "latest", `--secret=${name}`, `--project=${projectId}`],
    // quiet porque esto imprime la credencial en stdout al salir bien.
    { quiet: true, allowFailure: true },
  );
  return result.ok ? result.stdout : null;
}

function ensureSecret(projectId, name, value, report) {
  const existing = currentValue(projectId, name);

  if (existing === value) {
    report.push(`  ${name.padEnd(38)} sin cambios`);
    return;
  }

  if (existing === null) {
    const exists = run(
      "gcloud",
      ["secrets", "describe", name, `--project=${projectId}`, "--format=value(name)"],
      { allowFailure: true },
    );
    if (!exists.ok) {
      run("gcloud", [
        "secrets",
        "create",
        name,
        `--project=${projectId}`,
        "--replication-policy=automatic",
      ]);
    }
  }

  // `--data-file=-` lee de stdin. Es la única forma de que el valor no pase
  // por la línea de comandos.
  run("gcloud", ["secrets", "versions", "add", name, `--project=${projectId}`, "--data-file=-"], {
    input: value,
  });

  report.push(`  ${name.padEnd(38)} ${existing === null ? "creado" : "versión nueva"}`);
}

/**
 * Resuelve un secreto de aplicación cuya fuente de verdad es Secret Manager.
 *
 * Orden: lo que YA esté en Secret Manager; si no hay nada, uno nuevo al azar.
 * La configuración NO participa: ver NEVER_UPLOADED_FROM_CONFIG. Ese orden es
 * lo que hace que correr el script dos veces no rote nada: un secreto rotado
 * sin querer invalida todas las sesiones abiertas.
 *
 * Que el valor nazca acá y no en `.env.setup` es deliberado: un secreto de
 * producción que nunca toca el disco de una laptop es más difícil de filtrar
 * que uno que vive en un archivo plano. El de `.env.setup` es del entorno
 * local, y no tiene por qué coincidir.
 */
function resolveApplicationSecret(projectId, name) {
  const stored = currentValue(projectId, name);
  if (stored !== null && stored.length > 0)
    return { value: stored, origin: "ya en Secret Manager" };

  const generated = randomBytes(SECRET_BYTES).toString("base64url");
  registerSecret(generated);
  return { value: generated, origin: "generado ahora" };
}

function neonConnectionString(config, branch, { pooled }) {
  const args = [
    "connection-string",
    branch,
    `--project-id=${config.NEON_PROJECT_ID}`,
    `--org-id=${config.NEON_ORG_ID}`,
  ];
  if (pooled) args.push("--pooled");

  // NEON_API_KEY viaja por el entorno del hijo, sólo para autenticar a
  // neonctl: nunca se sube a ningún lado. Si está vacía, `neonctl` cae a la
  // sesión de `neonctl auth` de la máquina, que es lo que pasa en local.
  const env = {};
  if ((config.NEON_API_KEY ?? "").trim().length > 0) {
    env.NEON_API_KEY = config.NEON_API_KEY.trim();
  }

  return run("neonctl", args, { quiet: true, env });
}

const REQUIRED_CONFIG = ["GCP_PROJECT_ID", "NEON_PROJECT_ID", "NEON_ORG_ID"];

/** Las claves obligatorias que faltan (o están vacías) en la configuración. */
export function missingConfig(config) {
  return REQUIRED_CONFIG.filter((key) => (config[key] ?? "").trim().length === 0);
}

// Los secretos de runtime que la corrida real lee o crea, por entorno.
const RUNTIME_KEYS = ["database-url", "direct-url", "jwt-access-secret", "jwt-refresh-secret"];

/**
 * `--check`: lo que la corrida real necesita para no abortar a mitad, SIN
 * escribir nada. Devuelve la lista de problemas (vacía si puede correr).
 *
 * Recibe `run` para que el test vea qué comandos lanza: ninguno puede ser de
 * escritura (`create`, `versions add`, `add-iam-policy-binding`) ni leer el
 * valor de un secreto (`versions access`).
 */
export function checkCanRun(config, upload, { run: runCommand = run } = {}) {
  const missing = missingConfig(config);
  if (missing.length > 0) {
    return [`Faltan claves: ${missing.join(", ")}. Corré \`pnpm env:check\` para el detalle.`];
  }
  const uploadError = checkUploadsHaveValue(config, upload);
  if (uploadError !== null) return [uploadError];

  const projectId = config.GCP_PROJECT_ID.trim();
  const problems = [];
  const probe = (description, command, args) => {
    const result = runCommand(command, args, { quiet: true, allowFailure: true });
    if (!result.ok) problems.push(`${description}: ${result.stderr.trim() || "falló"}`);
  };

  probe(`Proyecto de GCP ${projectId}`, "gcloud", [
    "projects",
    "describe",
    projectId,
    "--format=value(projectId)",
  ]);

  const secrets = [];
  for (const environment of ENVIRONMENTS) {
    probe(`Rama ${environment.neonBranch} de Neon`, "neonctl", [
      "branches",
      "get",
      environment.neonBranch,
      `--project-id=${config.NEON_PROJECT_ID.trim()}`,
      `--org-id=${config.NEON_ORG_ID.trim()}`,
      "--output=json",
    ]);
    for (const key of RUNTIME_KEYS) secrets.push(secretName(environment.name, key));
  }
  for (const key of upload) secrets.push(UPLOADABLE_FROM_CONFIG[key]);

  // Metadatos de la última versión, nunca su valor.
  for (const name of secrets) {
    probe(`Secreto ${name}`, "gcloud", [
      "secrets",
      "versions",
      "describe",
      "latest",
      `--secret=${name}`,
      `--project=${projectId}`,
      "--format=value(state)",
    ]);
  }
  return problems;
}

function requireConfig(config) {
  const missing = missingConfig(config);
  if (missing.length > 0) {
    console.error(`Faltan claves: ${missing.join(", ")}`);
    console.error("Corré `pnpm env:check` para el detalle.");
    process.exit(1);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error !== undefined) {
    console.error(args.error);
    process.exit(1);
  }

  const config = loadConfig(args.envFile);

  if (args.check) {
    const problems = checkCanRun(config, args.upload);
    if (problems.length > 0) {
      console.error("secrets:gcp NO puede correr:");
      for (const problem of problems) console.error(`  - ${problem}`);
      process.exit(1);
    }
    console.log("secrets:gcp puede correr: config completa, proyecto de GCP, ramas de Neon y");
    console.log("secretos alcanzables. No se escribió nada ni se leyó el valor de ningún secreto.");
    return;
  }

  requireConfig(config);

  const uploadError = checkUploadsHaveValue(config, args.upload);
  if (uploadError !== null) {
    console.error(uploadError);
    process.exit(1);
  }

  const projectId = config.GCP_PROJECT_ID.trim();
  const report = [];

  for (const environment of ENVIRONMENTS) {
    // La pooled va en DATABASE_URL porque Cloud Run escala a varias instancias
    // y cada una abre su propio pool; sin el pooler de Neon las conexiones de
    // Postgres se agotan antes que cualquier otro recurso. La directa es sólo
    // para migraciones, que corren una vez y necesitan una sesión de verdad.
    const pooled = neonConnectionString(config, environment.neonBranch, { pooled: true });
    const direct = neonConnectionString(config, environment.neonBranch, { pooled: false });

    report.push(`${environment.name} (rama ${environment.neonBranch} de Neon)`);

    // Sin la configuración, a propósito: ver NEVER_UPLOADED_FROM_CONFIG.
    const access = resolveApplicationSecret(
      projectId,
      secretName(environment.name, "jwt-access-secret"),
    );
    const refresh = resolveApplicationSecret(
      projectId,
      secretName(environment.name, "jwt-refresh-secret"),
    );

    const values = {
      "database-url": pooled,
      "direct-url": direct,
      "jwt-access-secret": access.value,
      "jwt-refresh-secret": refresh.value,
    };

    for (const [key, value] of Object.entries(values)) {
      ensureSecret(projectId, secretName(environment.name, key), value, report);
      if (DEPLOYER_READABLE_KEYS.includes(key)) {
        grantDeployerAccess(projectId, secretName(environment.name, key), report);
      }
    }
    report.push(`    jwt access: ${access.origin} | jwt refresh: ${refresh.origin}`);
    report.push("");
  }

  for (const args of runtimeAccessBindings(projectId)) run("gcloud", args);
  report.push("  runtime: cada servicio lee sólo los secretos de su entorno (A4)");
  report.push("");

  // Lo que viene de la configuración: SÓLO lo pedido con --upload, ya validado
  // contra UPLOADABLE_FROM_CONFIG. El token de Vercel es una credencial de larga
  // vida que vive ACÁ y no en los secretos de GitHub; CI la lee por WIF (D-015).
  for (const key of args.upload) {
    const secret = UPLOADABLE_FROM_CONFIG[key];
    ensureSecret(projectId, secret, config[key].trim(), report);
    grantDeployerAccess(projectId, secret, report);
  }
  if (!args.upload.includes("VERCEL_TOKEN")) {
    report.push(
      `  ${CI_VERCEL_TOKEN_SECRET.padEnd(38)} no pedido (--upload=VERCEL_TOKEN para subirlo)`,
    );
  }
  report.push("");

  console.log(report.join("\n"));
  console.log("Ningún valor se imprimió. Los secretos se montan por referencia en el deploy,");
  console.log("nunca horneados en la imagen.");
}

// Sólo corre como programa, no al importarlo desde el test.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
