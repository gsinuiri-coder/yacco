/**
 * `node scripts/check-web-build.mjs` — construye el web como lo construye
 * `vercel build` en «5 · Web a Vercel» y revisa la salida con la misma guardia
 * que `deploy-web.mjs`. Corre en CI, antes del merge, sin token y sin red.
 *
 * Por qué existe: el deploy de 2ed19f1 falló en el job 5 con «No Output
 * Directory named "dist"». Nitro elige su preset según el proveedor que detecta
 * std-env, y en un runner de GitHub Actions `GITHUB_ACTIONS` gana sobre el
 * `VERCEL` que pone `vercel build`: salía `node-server`, no quedaba
 * `.vercel/output`, y la CLI caía al directorio por defecto del preset nuxtjs.
 * Ningún paso de CI construía el web para Vercel, así que nada lo vio antes
 * del merge.
 *
 * Qué corre: el `buildCommand` de `apps/web-nuxt/vercel.json` —el mismo que
 * corre `vercel build`—, desde `apps/web-nuxt` (el rootDirectory del proyecto)
 * y con las dos variables que la CLI le pone (`VERCEL` y `NOW_BUILDER`). Si el
 * preset volviera a depender de la detección, en el runner de CI saldría
 * `node-server` otra vez y este paso fallaría.
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { assertPublishable } from "./deploy-web.mjs";
import { REPO_ROOT, run } from "./lib.mjs";

export const WEB_DIR = join(REPO_ROOT, "apps", "web-nuxt");
export const WEB_BUILD_OUTPUT_CONFIG = join(WEB_DIR, ".vercel", "output", "config.json");

/**
 * Los argumentos de pnpm del `buildCommand`. Se lanza sin shell (D-003), así
 * que sólo vale un comando `pnpm` con argumentos simples: nada que un shell
 * tendría que interpretar, ni una variable delante del comando.
 */
export function buildCommandArgs(vercelJson) {
  const command = (vercelJson?.buildCommand ?? "").trim();
  const [program, ...args] = command.split(/\s+/);
  if (program !== "pnpm" || args.length === 0) {
    throw new Error(`buildCommand tiene que ser un comando pnpm: ${JSON.stringify(command)}`);
  }
  if (args.some((arg) => /["'`$&|;<>()\\]/.test(arg))) {
    throw new Error(`buildCommand no puede necesitar un shell: ${JSON.stringify(command)}`);
  }
  return args;
}

function main() {
  const vercelJson = JSON.parse(readFileSync(join(WEB_DIR, "vercel.json"), "utf8"));
  const args = buildCommandArgs(vercelJson);

  // Una salida de un build anterior haría pasar la guardia sin haber probado nada.
  rmSync(dirname(WEB_BUILD_OUTPUT_CONFIG), { recursive: true, force: true });

  // Al entorno del proceso y no a `options.env` de run(): todo lo que pasa por
  // ahí se registra como secreto y se tacha, y tachar "1" arruina cualquier log.
  process.env.VERCEL = "1";
  process.env.NOW_BUILDER = "1";

  console.error(`Construyendo el web como vercel build: pnpm ${args.join(" ")}`);
  run("pnpm", args, { cwd: WEB_DIR });

  if (!existsSync(WEB_BUILD_OUTPUT_CONFIG)) {
    throw new Error(
      `El build no dejó ${WEB_BUILD_OUTPUT_CONFIG}: Nitro no corrió con el preset vercel, ` +
        'y `vercel build` fallaría con «No Output Directory named "dist"».',
    );
  }
  assertPublishable(WEB_BUILD_OUTPUT_CONFIG);
  console.error("Build Output del web: OK.");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
