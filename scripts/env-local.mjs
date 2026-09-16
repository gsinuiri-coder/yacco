/**
 * `pnpm env:local` — escribe los `.env` de cada app a partir de `.env.setup`,
 * apuntando al Postgres LOCAL de Docker.
 *
 * No toca ninguna base desplegada: existe para que `pnpm dev:api` arranque con
 * los mismos secretos que el resto de la migración, sin que nadie tenga que
 * copiar valores a mano entre archivos (que es como terminan pegados en un
 * chat).
 *
 * El puerto del Postgres local se AVERIGUA, no se asume. `docker-compose.yml`
 * declara 5432, pero `docker-compose.override.yml` —ignorado por git, y por lo
 * tanto distinto en cada máquina— puede remapearlo; en la del dueño está en
 * 5433, y el 5432 lo contesta otro servidor que devuelve un error de
 * autenticación engañoso.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, readEnvFile, run } from "./lib.mjs";

const COMPOSE_SERVICE = "postgres";
const COMPOSE_INTERNAL_PORT = "5432";
const DEFAULT_PORT = "5432";
const API_PORT = "3100";
const WEB_DEV_ORIGIN = "http://localhost:5173";

/**
 * Pregunta primero a Docker, que es la única fuente que ya resolvió el
 * override. Si el contenedor no está levantado, cae a leer el override, y
 * recién después al valor declarado en el compose base.
 */
function resolveLocalPostgresPort() {
  const mapped = run("docker", ["compose", "port", COMPOSE_SERVICE, COMPOSE_INTERNAL_PORT], {
    allowFailure: true,
  });
  if (mapped.ok) {
    const port = mapped.stdout.trim().split(":").pop();
    if (/^\d+$/.test(port ?? "")) {
      return { port, source: "docker compose port" };
    }
  }

  const overridePath = join(REPO_ROOT, "docker-compose.override.yml");
  if (existsSync(overridePath)) {
    const match = /["']?(\d+):5432["']?/.exec(readFileSync(overridePath, "utf8"));
    if (match !== null) {
      return { port: match[1], source: "docker-compose.override.yml" };
    }
  }

  return { port: DEFAULT_PORT, source: "docker-compose.yml (sin override)" };
}

function requireKeys(env, keys) {
  const missing = keys.filter((key) => (env[key] ?? "").trim().length === 0);
  if (missing.length > 0) {
    console.error(`Faltan claves en .env.setup: ${missing.join(", ")}`);
    console.error("Corré `pnpm env:check` para el detalle, y `pnpm secrets:generate` si son JWT.");
    process.exit(1);
  }
}

function main() {
  const env = readEnvFile();
  requireKeys(env, [
    "JWT_ACCESS_SECRET",
    "JWT_REFRESH_SECRET",
    "JWT_ACCESS_EXPIRES_IN",
    "JWT_REFRESH_EXPIRES_IN",
  ]);

  const { port, source } = resolveLocalPostgresPort();
  const localUrl = `postgresql://yacco:yacco@localhost:${port}/yacco_dev`;

  // DATABASE_URL y DIRECT_URL son el mismo valor en local a propósito: el
  // pooler de Neon no existe acá, y Prisma resuelve las dos eagerly porque
  // ambas están declaradas en el bloque datasource.
  const apiEnv = [
    "# Generado por `pnpm env:local`. No lo edites a mano: se regenera.",
    "# Apunta SIEMPRE al Postgres local de Docker, nunca a Neon.",
    `DATABASE_URL=${localUrl}`,
    `DIRECT_URL=${localUrl}`,
    `JWT_ACCESS_SECRET=${env.JWT_ACCESS_SECRET}`,
    `JWT_ACCESS_EXPIRES_IN=${env.JWT_ACCESS_EXPIRES_IN}`,
    `JWT_REFRESH_SECRET=${env.JWT_REFRESH_SECRET}`,
    `JWT_REFRESH_EXPIRES_IN=${env.JWT_REFRESH_EXPIRES_IN}`,
    `PORT=${API_PORT}`,
    `WEB_ORIGIN=${WEB_DEV_ORIGIN}`,
    "",
  ].join("\n");

  // El web local pega a la API local directo, sin el rewrite de Vercel: en
  // `vite dev` no hay nada que reescriba /api/*.
  const webEnv = [
    "# Generado por `pnpm env:local`. No lo edites a mano: se regenera.",
    `VITE_API_BASE_URL=http://localhost:${API_PORT}/api/v1`,
    "",
  ].join("\n");

  const targets = [
    { path: join(REPO_ROOT, "apps", "api", ".env"), contents: apiEnv },
    { path: join(REPO_ROOT, "apps", "web", ".env"), contents: webEnv },
  ];

  for (const target of targets) {
    writeFileSync(target.path, target.contents, { encoding: "utf8", mode: 0o600 });
    console.log(`  escrito ${target.path.replace(REPO_ROOT, ".")}`);
  }

  console.log("");
  console.log(`Postgres local en el puerto ${port} (según ${source}).`);
  console.log("Ningún valor se imprimió. Levantá la base con `pnpm demo:up`.");
}

main();
