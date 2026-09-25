/**
 * Poda el `node_modules` que arma `pnpm deploy --prod` para la imagen de la
 * API: borra de `.pnpm` todo paquete que ninguna dependencia de runtime
 * alcanza. Lo corre el Dockerfile, en la etapa `build`:
 *
 *   node scripts/prune-runtime-deps.mjs /app
 *
 * Por qué hace falta. `pnpm deploy --prod` instala también los peers
 * OPCIONALES que el lockfile resolvió en el workspace. `@prisma/client`
 * declara `prisma` (el CLI) y `typescript` como peers opcionales, y los dos
 * están en el workspace como devDependencies: la imagen terminaba cargando el
 * CLI de Prisma con sus ~40 dependencias (entre ellas `deepmerge-ts`, con un
 * hallazgo HIGH del escaneo) y 23 MB de compilador, sin que el runtime use
 * ninguno. Las migraciones corren en su propio paso de CI, con las
 * devDependencies, nunca desde la imagen.
 *
 * Qué cuenta como alcanzable, desde el `package.json` de la raíz:
 * `dependencies`, `optionalDependencies` y los `peerDependencies` que NO son
 * opcionales. Cada nombre se resuelve como lo haría Node, subiendo por los
 * `node_modules`, así que el enlace de pnpm y su `.pnpm/node_modules` (lo
 * izado) valen igual que en runtime. Una dependencia opcional que no está
 * instalada (la de otra plataforma) no es un error.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { pathToFileURL } from "node:url";

/** Los nombres que un paquete necesita en runtime, según su manifiesto. */
export function runtimeDependencyNames(manifest) {
  const optionalPeers = new Set(
    Object.entries(manifest.peerDependenciesMeta ?? {})
      .filter(([, meta]) => meta?.optional === true)
      .map(([name]) => name),
  );
  const requiredPeers = Object.keys(manifest.peerDependencies ?? {}).filter(
    (name) => !optionalPeers.has(name),
  );
  return [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...requiredPeers,
  ];
}

/** Dónde encontraría Node el paquete `name` pedido desde `fromDir`, o null. */
function resolvePackageDir(fromDir, name) {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Los directorios reales de todos los paquetes alcanzables desde `root`. */
export function reachablePackageDirs(root) {
  const reachable = new Set();
  const pending = [realpathSync(root)];
  while (pending.length > 0) {
    const dir = pending.pop();
    if (reachable.has(dir)) continue;
    reachable.add(dir);
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    for (const name of runtimeDependencyNames(manifest)) {
      const found = resolvePackageDir(dir, name);
      if (found !== null) pending.push(found);
    }
  }
  return reachable;
}

/**
 * Las entradas de `node_modules/.pnpm` que ningún paquete alcanzable usa.
 * Cada entrada es `<nombre>@<versión>[_peers]/node_modules/<nombre>`; su
 * `node_modules/.pnpm/node_modules` (lo izado) y `lock.yaml` no son paquetes.
 */
export function unreachableStoreEntries(root) {
  const store = join(realpathSync(root), "node_modules", ".pnpm");
  const reachable = [...reachablePackageDirs(root)];
  return readdirSync(store, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "node_modules")
    .map((entry) => entry.name)
    .filter((name) => {
      const prefix = join(store, name) + sep;
      return !reachable.some((dir) => dir.startsWith(prefix));
    })
    .sort();
}

function main() {
  const root = process.argv[2];
  if (root === undefined) {
    console.error("Uso: node scripts/prune-runtime-deps.mjs <directorio de pnpm deploy>");
    process.exit(1);
  }
  const store = join(root, "node_modules", ".pnpm");
  const removed = unreachableStoreEntries(root);
  for (const name of removed) rmSync(join(store, name), { recursive: true, force: true });
  console.log(`Podados ${removed.length} paquetes que el runtime no alcanza:`);
  for (const name of removed) console.log(`  ${name}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
