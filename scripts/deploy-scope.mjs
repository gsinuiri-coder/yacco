/**
 * ¿Lo que cambió entre lo desplegado en producción y un commit toca algo que
 * corre? Lo usan el gate del deploy (un merge que solo toca documentación no
 * redespliega, backlog «Cada merge de documentación redespliega producción»)
 * y el chequeo programado de `drift.yml` (producción atrás de `main` sin que
 * nadie se entere, backlog «El auto-deploy de yacco-api puede no dispararse
 * sin error visible»).
 *
 *   node scripts/deploy-scope.mjs <sha>     → imprime `runtime` o `docs-only`
 *
 * Ante la duda, `runtime`: si /health no responde, si el commit desplegado no
 * se conoce o si la comparación no se puede hacer entera, se despliega. Saltar
 * un deploy necesario es peor que hacer uno de más.
 *
 * Sin dependencias: `fetch` para /health y `gh api` para la comparación (el
 * runner trae `gh` y su token por GH_TOKEN).
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { TARGETS } from "./smoke.mjs";

/**
 * Lo que NO llega a ninguna imagen ni build: documentación y reglas de los
 * agentes. `.github/` y `scripts/` quedan afuera a propósito: el deploy y el
 * smoke corren desde ahí, y un cambio en ellos tiene que probarse desplegando.
 */
const DOCS_ONLY = [/^docs\//, /\.md$/, /^\.agents\//, /^\.claude\//];

export function isDocsOnlyPath(path) {
  return DOCS_ONLY.some((pattern) => pattern.test(path));
}

/** `docs-only` solo si hay archivos y TODOS son de documentación. */
export function classifyChange(files) {
  if (files.length === 0) return "runtime";
  return files.every(isDocsOnlyPath) ? "docs-only" : "runtime";
}

// La API de comparación de GitHub devuelve hasta 300 archivos; con más, la
// lista está cortada y no se puede afirmar que todo sea documentación.
const COMPARE_FILE_LIMIT = 300;

/**
 * La decisión entera, con sus dependencias inyectables. `deployedCommit` es el
 * `commit` de /health de producción; `compare(base, head)` devuelve
 * `{ status, files }` como la API de GitHub.
 */
export async function deployScope({ sha, deployedCommit, compare }) {
  if (!deployedCommit) return { scope: "runtime", reason: "no se sabe qué está desplegado" };
  // Sin atajo para «ya está desplegado»: el único camino por el que el gate ve
  // producción en ESTE commit es relanzar la corrida después de que falló el
  // web (5) o el smoke (6), y saltearla pintaría de verde un deploy roto. La
  // comparación da «identical», que despliega.
  let comparison;
  try {
    comparison = await compare(deployedCommit, sha);
  } catch {
    return { scope: "runtime", reason: "no se pudo comparar con lo desplegado" };
  }
  // `ahead`: sha desciende de lo desplegado. Cualquier otra cosa (behind,
  // diverged) es rara y se despliega para salir de dudas.
  if (comparison.status !== "ahead") {
    return { scope: "runtime", reason: `lo desplegado está ${comparison.status}` };
  }
  if (comparison.files.length >= COMPARE_FILE_LIMIT) {
    return { scope: "runtime", reason: "demasiados archivos para compararlos" };
  }
  const scope = classifyChange(comparison.files);
  return {
    scope,
    reason:
      scope === "docs-only"
        ? `${comparison.files.length} archivos, todos de documentación`
        : "cambia código o configuración",
  };
}

export async function productionCommit(fetchImpl = fetch) {
  try {
    const response = await fetchImpl(`${TARGETS.apis.production}/health`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return null;
    const body = await response.json();
    return typeof body.commit === "string" && body.commit !== "" ? body.commit : null;
  } catch {
    return null;
  }
}

function githubCompare(base, head) {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) throw new Error("Falta GITHUB_REPOSITORY");
  const output = execFileSync(
    "gh",
    [
      "api",
      `repos/${repository}/compare/${base}...${head}`,
      "--jq",
      "{status: .status, files: [.files[].filename]}",
    ],
    { encoding: "utf8" },
  );
  return JSON.parse(output);
}

async function main() {
  const sha = process.argv[2];
  if (!sha) throw new Error("Uso: node scripts/deploy-scope.mjs <sha>");
  const deployedCommit = await productionCommit();
  const { scope, reason } = await deployScope({ sha, deployedCommit, compare: githubCompare });
  console.error(`deploy-scope: ${scope} (${reason})`);
  console.log(scope);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
