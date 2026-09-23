/**
 * `pnpm deploy:web` — construye el web y lo publica en el proyecto `yacco-web`
 * de Vercel. Imprime SÓLO la URL del deploy.
 *
 *   pnpm deploy:web                producción: queda detrás de yacco-web.vercel.app
 *   pnpm deploy:web --preview      un preview: URL única, detrás del login de Vercel
 *
 * El build corre ACÁ (en el runner de CI o en la máquina de quien lo lanza) y
 * se sube ya construido (`vercel build` + `vercel deploy --prebuilt`), en vez
 * de dejar que Vercel construya por su cuenta desde git. Así lo que se publica
 * es exactamente el commit que CI acaba de probar, y el proyecto de Vercel no
 * necesita acceso al repositorio.
 *
 * Lo que se construye es `apps/web-nuxt` (D-023): el proyecto tiene
 * `rootDirectory: apps/web-nuxt`, así que `vercel build` usa el vercel.json de
 * esa carpeta (installCommand, buildCommand, framework). Nitro escribe su Build
 * Output en `apps/web-nuxt/.vercel/output` y la CLI lo copia a
 * `.vercel/output` de la raíz, que es donde `deploy --prebuilt` lo busca.
 *
 * Entre el build y el deploy, `checkBuildOutput` lee ese `config.json` y
 * aborta si la salida no es la que D-021 exige: nada se publica sin la ruta de
 * producción por host delante del default a demo.
 *
 * El token viaja por el ENTORNO del hijo (VERCEL_TOKEN), nunca por `--token`:
 * un argumento es visible en `ps` y queda en el historial. En CI el token sale
 * de Secret Manager por Workload Identity (D-015); a mano, si no hay token, la
 * CLI usa la sesión de `vercel login` de la máquina.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { REPO_ROOT, loadConfig, run } from "./lib.mjs";
import { TARGETS } from "./smoke.mjs";

// No son secretos: identifican el team y el proyecto, no autorizan nada. Lo
// que autoriza es VERCEL_TOKEN.
export const VERCEL_ORG_ID = "team_qdzn9Mh8kLIgkekpqYuNxGR3";
export const VERCEL_PROJECT_ID = "prj_CgKR5MHXsMTG0CzdxHo5huNLEaiU";

/** Los argumentos de cada comando de la CLI, según el destino. */
export function vercelSteps({ preview }) {
  const environment = preview ? "preview" : "production";
  const prod = preview ? [] : ["--prod"];
  return [
    ["pull", "--yes", `--environment=${environment}`],
    ["build", ...prod],
    ["deploy", "--prebuilt", ...prod],
  ];
}

export const BUILD_OUTPUT_CONFIG = join(REPO_ROOT, ".vercel", "output", "config.json");

const PRODUCTION_HOST = new URL(TARGETS.web).host;

/** Los dos caminos que D-012/D-021 mandan por host: `/api/*` y su testigo. */
const PROXIED_SOURCES = ["^/api/(.*)$", "^/health$"];

function isHostOnly(route, host) {
  return (
    Array.isArray(route.has) &&
    route.has.length === 1 &&
    route.has[0].type === "host" &&
    route.has[0].value === host
  );
}

/**
 * Revisa el `config.json` del Build Output antes de publicarlo. Devuelve la
 * lista de problemas; vacía = se puede publicar.
 *
 * 1. Para `/api/*` y `/health`, la ruta con `has: host == yacco-web.vercel.app`
 *    hacia yacco-api existe y va ANTES del default a demo (D-011, D-021). Si
 *    faltara, el dominio de producción caería en demo sin que nada lo avise;
 *    si fuera después, el default la taparía.
 * 2. Ninguna ruta reescribe a `/index.html`: ese catch-all era del web React y
 *    en Nuxt taparía el SSR (`/__fallback`).
 * 3. Los headers anti-enmarcado (A6) están en una ruta para `/(.*)`.
 */
export function checkBuildOutput(config) {
  const routes = config?.routes;
  if (!Array.isArray(routes)) {
    return ["config.json no tiene `routes`: no es un Build Output de Nuxt para Vercel"];
  }

  const problems = [];
  for (const src of PROXIED_SOURCES) {
    const production = routes.findIndex(
      (route) =>
        route.src === src &&
        isHostOnly(route, PRODUCTION_HOST) &&
        route.dest?.startsWith(TARGETS.apis.production),
    );
    const demo = routes.findIndex(
      (route) =>
        route.src === src && route.has === undefined && route.dest?.startsWith(TARGETS.apis.demo),
    );
    if (production === -1) {
      problems.push(
        `falta la ruta ${src} con has host == "${PRODUCTION_HOST}" hacia ${TARGETS.apis.production}`,
      );
    } else if (demo !== -1 && demo < production) {
      problems.push(
        `la ruta ${src} de producción (posición ${production}) va DESPUÉS del default a demo ` +
          `(posición ${demo}): el default la tapa`,
      );
    }
  }

  if (routes.some((route) => route.dest === "/index.html")) {
    problems.push("hay una ruta hacia /index.html: el catch-all del web React taparía el SSR");
  }

  const frameHeaders = routes.find(
    (route) =>
      route.src === "/(.*)" &&
      route.headers?.["X-Frame-Options"] === "DENY" &&
      // includes y no igualdad: una CSP completa (backlog) sumará directivas.
      (route.headers?.["Content-Security-Policy"] ?? "").includes("frame-ancestors 'none'"),
  );
  if (frameHeaders === undefined) {
    problems.push("faltan los headers anti-enmarcado (A6) para /(.*)");
  }
  return problems;
}

/** Lee el config.json del build. Si no existe, es un error: nunca un vacío. */
export function readBuildOutput(path = BUILD_OUTPUT_CONFIG) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Lee y revisa el build; lanza si no se puede publicar. Lo llama main() entre build y deploy. */
export function assertPublishable(path = BUILD_OUTPUT_CONFIG) {
  const problems = checkBuildOutput(readBuildOutput(path));
  if (problems.length > 0) {
    throw new Error(
      `El build no se publica: ${path} no es el que exige D-021.\n` +
        problems.map((problem) => `  - ${problem}`).join("\n"),
    );
  }
}

function main() {
  const config = loadConfig();
  const preview = process.argv.includes("--preview");

  // Los ids van al entorno del proceso y no a `options.env` de run(): todo lo
  // que pasa por ahí se registra como secreto y se tacha de la salida, y
  // tachar un id que no es secreto sólo hace ilegible un mensaje de error.
  process.env.VERCEL_ORG_ID = (config.VERCEL_ORG_ID ?? VERCEL_ORG_ID).trim();
  process.env.VERCEL_PROJECT_ID = (config.VERCEL_PROJECT_ID ?? VERCEL_PROJECT_ID).trim();

  const env = {};
  const token = (config.VERCEL_TOKEN ?? "").trim();
  if (token.length > 0) {
    env.VERCEL_TOKEN = token;
  } else if (process.env.CI === "true") {
    // En CI no hay sesión de `vercel login` a la que caer: sin token, la CLI
    // abriría un prompt de login y el job quedaría colgado hasta el timeout.
    throw new Error(
      "Falta VERCEL_TOKEN. En CI sale de Secret Manager (yacco-ci-vercel-token); " +
        "ver D-015 en docs/ARQUITECTURA.md.",
    );
  }

  const [pull, build, deploy] = vercelSteps({ preview });
  console.error(
    `Trayendo la configuración del proyecto (${preview ? "preview" : "producción"})...`,
  );
  run("vercel", pull, { env });
  console.error("Construyendo el web...");
  run("vercel", build, { env });

  assertPublishable();
  console.error("Publicando...");
  const url = run("vercel", deploy, { env });

  // Lo único que va a stdout: la URL del deploy.
  console.log(url.split(/\r?\n/).pop());
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
