/**
 * `pnpm secrets:gcp` — sube a Secret Manager lo que Cloud Run necesita, para
 * producción y para demo. Idempotente.
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
import { loadConfig, registerSecret, run } from "./lib.mjs";

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

function secretName(environment, key) {
  return `yacco-${environment}-${key}`;
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
 * Orden: lo que diga la configuración; si no, lo que YA esté en Secret
 * Manager; si tampoco, uno nuevo al azar. Ese orden es lo que hace que correr
 * el script dos veces no rote nada: un secreto rotado sin querer invalida
 * todas las sesiones abiertas.
 *
 * Que el valor pueda nacer acá y no en `.env.setup` es deliberado: un secreto
 * de producción que nunca toca el disco de una laptop es más difícil de
 * filtrar que uno que vive en un archivo plano. El de `.env.setup` sigue
 * existiendo, para el entorno local, y no tienen por qué coincidir.
 */
function resolveApplicationSecret(projectId, name, configured) {
  const fromConfig = (configured ?? "").trim();
  if (fromConfig.length > 0) return { value: fromConfig, origin: "configuración" };

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

  // NEON_API_KEY viaja por el entorno del hijo. Si está vacía, `neonctl` cae a
  // la sesión de `neonctl auth` de la máquina, que es lo que pasa en local.
  const env = {};
  if ((config.NEON_API_KEY ?? "").trim().length > 0) {
    env.NEON_API_KEY = config.NEON_API_KEY.trim();
  }

  return run("neonctl", args, { quiet: true, env });
}

function requireConfig(config, keys) {
  const missing = keys.filter((key) => (config[key] ?? "").trim().length === 0);
  if (missing.length > 0) {
    console.error(`Faltan claves: ${missing.join(", ")}`);
    console.error("Corré `pnpm env:check` para el detalle.");
    process.exit(1);
  }
}

function main() {
  const config = loadConfig();
  // Los JWT no están en la lista a propósito: si faltan, Secret Manager los
  // aporta o se generan. Ver resolveApplicationSecret.
  requireConfig(config, ["GCP_PROJECT_ID", "NEON_PROJECT_ID", "NEON_ORG_ID"]);

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

    const access = resolveApplicationSecret(
      projectId,
      secretName(environment.name, "jwt-access-secret"),
      config.JWT_ACCESS_SECRET,
    );
    const refresh = resolveApplicationSecret(
      projectId,
      secretName(environment.name, "jwt-refresh-secret"),
      config.JWT_REFRESH_SECRET,
    );

    const values = {
      "database-url": pooled,
      "direct-url": direct,
      "jwt-access-secret": access.value,
      "jwt-refresh-secret": refresh.value,
    };

    for (const [key, value] of Object.entries(values)) {
      ensureSecret(projectId, secretName(environment.name, key), value, report);
    }
    report.push(`    jwt access: ${access.origin} | jwt refresh: ${refresh.origin}`);
    report.push("");
  }

  console.log(report.join("\n"));
  console.log("Ningún valor se imprimió. Los secretos se montan por referencia en el deploy,");
  console.log("nunca horneados en la imagen.");
}

main();
