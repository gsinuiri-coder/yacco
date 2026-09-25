/**
 * Mira DENTRO de la imagen de la API ya construida, no el texto del
 * Dockerfile: la corre CI después del `docker build`.
 *
 *   node scripts/check-api-image.mjs yacco-api:ci
 *
 * Falla si la etapa final trae un gestor de paquetes (npm, npx, corepack,
 * yarn, pnpm) o algo que la poda de `prune-runtime-deps.mjs` tenía que sacar
 * (el CLI de Prisma y su árbol, TypeScript). Es lo que el escaneo de
 * Artifact Registry marcaba como HIGH; acá se ve en el PR, antes del deploy.
 *
 * El inventario lo arma el `node` de la propia imagen: no hay shell que
 * asumir, y es el mismo binario que después corre la API.
 */
import { pathToFileURL } from "node:url";

import { run } from "./lib.mjs";

const PACKAGE_MANAGERS = ["npm", "npx", "corepack", "yarn", "yarnpkg", "pnpm", "pnpx"];

// Entradas de node_modules/.pnpm que no pueden estar: el CLI de Prisma (y la
// dependencia con el HIGH que trae) y el compilador. El cliente de Prisma
// (`@prisma+client@...`) SÍ tiene que estar.
const FORBIDDEN_STORE_ENTRY =
  /^(prisma@|@prisma\+config@|@prisma\+engines@|deepmerge-ts@|typescript@)/;

const INVENTORY_SCRIPT = `
const fs = require("node:fs");
const list = (dir) => { try { return fs.readdirSync(dir); } catch { return []; } };
process.stdout.write(JSON.stringify({
  bin: list("/usr/local/bin"),
  globalModules: list("/usr/local/lib/node_modules"),
  opt: list("/opt"),
  store: list("/app/node_modules/.pnpm"),
}));
`;

/** Qué sobra en la imagen, según su inventario. Vacío si está bien. */
export function apiImageProblems({ bin, globalModules, opt, store }) {
  const problems = [];
  const managers = bin.filter((name) => PACKAGE_MANAGERS.includes(name));
  if (managers.length > 0) problems.push(`/usr/local/bin trae ${managers.join(", ")}`);
  if (globalModules.length > 0) {
    problems.push(`/usr/local/lib/node_modules trae ${globalModules.join(", ")}`);
  }
  const yarn = opt.filter((name) => name.startsWith("yarn"));
  if (yarn.length > 0) problems.push(`/opt trae ${yarn.join(", ")}`);
  const forbidden = store.filter((name) => FORBIDDEN_STORE_ENTRY.test(name));
  if (forbidden.length > 0) problems.push(`node_modules/.pnpm trae ${forbidden.join(", ")}`);
  if (!store.some((name) => name.startsWith("@prisma+client@"))) {
    problems.push("node_modules/.pnpm NO trae @prisma/client: la poda se llevó el runtime");
  }
  return problems;
}

function main() {
  const image = process.argv[2];
  if (image === undefined) {
    console.error("Uso: node scripts/check-api-image.mjs <imagen>");
    process.exit(1);
  }
  const inventory = JSON.parse(
    run("docker", ["run", "--rm", "--entrypoint", "node", image, "-e", INVENTORY_SCRIPT]),
  );
  const problems = apiImageProblems(inventory);
  if (problems.length > 0) {
    console.error(`La imagen ${image} trae lo que el runtime no usa:`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log(`${image}: sólo node y las dependencias de runtime.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
