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
 * necesita acceso al repositorio. Cómo se construye está en vercel.json
 * (installCommand, buildCommand, outputDirectory).
 *
 * El token viaja por el ENTORNO del hijo (VERCEL_TOKEN), nunca por `--token`:
 * un argumento es visible en `ps` y queda en el historial. En CI el token sale
 * de Secret Manager por Workload Identity (D-015); a mano, si no hay token, la
 * CLI usa la sesión de `vercel login` de la máquina.
 */
import { pathToFileURL } from "node:url";
import { loadConfig, run } from "./lib.mjs";

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
