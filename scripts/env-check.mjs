/**
 * `pnpm env:check` — dice qué falta en `.env.setup` SIN imprimir ningún valor.
 *
 * Imprime, por clave, sólo uno de: `ok`, `falta`, `formato` o `cli`. Nunca el
 * contenido. Eso es lo que lo hace seguro de pegar en un chat, en un issue o
 * en la salida de un agente.
 */
import { existsSync } from "node:fs";
import { ENV_SETUP_PATH, loadConfig } from "./lib.mjs";
import { ENV_KEYS } from "./env-keys.mjs";

const GREEN = "[32m";
const RED = "[31m";
const YELLOW = "[33m";
const DIM = "[2m";
const RESET = "[0m";

function main() {
  // La ausencia del archivo no es un error: en CI no existe y cada valor
  // llega por el entorno. Se avisa y se sigue evaluando, porque lo que
  // importa es si la configuración EFECTIVA está completa, no de dónde sale.
  if (!existsSync(ENV_SETUP_PATH)) {
    console.log(`${YELLOW}aviso${RESET} no hay .env.setup; evalúo sólo el entorno del proceso.`);
    console.log(`${DIM}      para crearlo:  cp .env.setup.example .env.setup${RESET}`);
    console.log("");
  }

  const env = loadConfig();
  const missing = [];
  const malformed = [];
  const cliFallback = [];

  for (const entry of ENV_KEYS) {
    const value = (env[entry.key] ?? "").trim();
    const present = value.length > 0;

    let status;
    if (present && entry.pattern !== undefined && !entry.pattern.test(value)) {
      status = `${RED}formato${RESET}`;
      malformed.push(entry);
    } else if (present) {
      status = `${GREEN}ok${RESET}`;
    } else if (entry.required === true) {
      status = `${RED}falta${RESET}`;
      missing.push(entry);
    } else if (entry.required === "cli") {
      status = `${YELLOW}cli${RESET}`;
      cliFallback.push(entry);
    } else {
      status = `${DIM}opcional${RESET}`;
    }

    console.log(`  ${entry.key.padEnd(24)} ${status}`);
  }

  console.log("");

  for (const entry of cliFallback) {
    console.log(
      `${YELLOW}aviso${RESET} ${entry.key} está vacía; los scripts van a usar la sesión de \`${entry.cli}\`.`,
    );
  }

  for (const entry of malformed) {
    console.log(`${RED}formato${RESET} ${entry.key}: ${entry.description}`);
  }

  if (missing.length > 0) {
    console.log("");
    console.log(`${RED}Faltan ${missing.length} clave(s) obligatoria(s):${RESET}`);
    for (const entry of missing) {
      const how =
        entry.generated === true ? "la genera `pnpm secrets:generate`" : entry.description;
      console.log(`  - ${entry.key}: ${how}`);
    }
  }

  if (missing.length > 0 || malformed.length > 0) {
    process.exit(1);
  }

  console.log(`${GREEN}.env.setup está completo.${RESET}`);
}

main();
