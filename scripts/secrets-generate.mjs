/**
 * `pnpm secrets:generate` — genera `JWT_ACCESS_SECRET` y `JWT_REFRESH_SECRET`
 * y los escribe en `.env.setup` SIN imprimirlos.
 *
 * Son nuevos a propósito, no copiados de Render: un secreto que ya vivió en
 * otra plataforma no gana nada mudándose. Rotarlos sólo invalida las sesiones
 * abiertas (no hay tabla `sessions`; el access token caduca solo y el refresh
 * deja de validar), y hoy el único usuario es el dueño del repo.
 *
 * Por defecto NO pisa un valor que ya existe: correrlo dos veces es inocuo.
 * `--force` rota los dos, que es lo que hay que hacer si alguna vez se filtran.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { ENV_SETUP_PATH, readEnvFile } from "./lib.mjs";
import { GENERATED_SECRETS } from "./env-keys.mjs";

// 48 bytes -> 64 caracteres en base64url. Holgadamente por encima de los 256
// bits que pide HS256, que es lo que firma @nestjs/jwt acá.
const SECRET_BYTES = 48;

function generateSecret() {
  return randomBytes(SECRET_BYTES).toString("base64url");
}

/**
 * Reemplaza el valor de `key` conservando el resto del archivo intacto:
 * comentarios, orden y claves ajenas a esta migración. Reescribir el archivo
 * desde cero perdería las claves que el dueño puso a mano.
 */
function upsert(contents, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^(?:export\\s+)?${key}\\s*=.*$`, "m");
  if (pattern.test(contents)) {
    return contents.replace(pattern, line);
  }
  const separator = contents.length === 0 || contents.endsWith("\n") ? "" : "\n";
  return `${contents}${separator}${line}\n`;
}

function main() {
  const force = process.argv.includes("--force");

  if (!existsSync(ENV_SETUP_PATH)) {
    console.error("No existe .env.setup. Crealo primero:  cp .env.setup.example .env.setup");
    process.exit(1);
  }

  const existing = readEnvFile();
  let contents = readFileSync(ENV_SETUP_PATH, "utf8");
  const written = [];
  const kept = [];

  for (const key of GENERATED_SECRETS) {
    const current = (existing[key] ?? "").trim();
    if (current.length > 0 && !force) {
      kept.push(key);
      continue;
    }
    contents = upsert(contents, key, generateSecret());
    written.push(key);
  }

  if (written.length > 0) {
    writeFileSync(ENV_SETUP_PATH, contents, { encoding: "utf8", mode: 0o600 });
  }

  for (const key of kept) {
    console.log(`  ${key}: ya tenía valor, lo dejo como está (--force para rotarlo).`);
  }
  for (const key of written) {
    console.log(`  ${key}: generado, ${SECRET_BYTES} bytes aleatorios, escrito en .env.setup.`);
  }

  if (written.length > 0) {
    console.log("");
    console.log("Los valores no se imprimen. Para llevarlos a Cloud Run:  pnpm secrets:gcp");
  }
}

main();
