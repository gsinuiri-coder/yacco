/**
 * `node scripts/production-drift.mjs` — ¿producción corre lo que dice `main`?
 * Lo corre `.github/workflows/drift.yml` cada hora; si falla, GitHub avisa por
 * email.
 *
 * Existe porque un merge puede no desplegarse sin que nada se ponga rojo: el
 * CI de push a veces no se dispara (le pasó a #202), y sin CI no hay deploy,
 * así que producción sigue con el código anterior y todos los checks en
 * verde. Backlog: «El auto-deploy de yacco-api puede no dispararse sin error
 * visible».
 *
 * Producción está al día si su /health dice la punta de `main`, o si lo que
 * falta desplegar es solo documentación (deploy-scope.mjs). Si no, se da
 * margen a un deploy en curso: CI y el deploy tardan juntos menos de una hora.
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { deployScope, productionCommit } from "./deploy-scope.mjs";

/** Minutos que se le dan a un merge para llegar a producción antes de avisar. */
export const GRACE_MINUTES = 90;

/**
 * El veredicto. `tip` es `{ sha, committedAt }` de la punta de main;
 * `deployedCommit`, el de /health de producción (o null).
 */
export async function driftVerdict({ tip, deployedCommit, compare, now = new Date() }) {
  if (deployedCommit === tip.sha)
    return { ok: true, message: "Producción corre la punta de main." };
  const { scope } = await deployScope({ sha: tip.sha, deployedCommit, compare });
  if (scope === "docs-only") {
    return { ok: true, message: "Lo que falta desplegar es solo documentación." };
  }
  const minutes = Math.floor((now.getTime() - new Date(tip.committedAt).getTime()) / 60_000);
  if (minutes < GRACE_MINUTES) {
    return {
      ok: true,
      message: `La punta de main tiene ${minutes} min: el deploy puede estar en curso.`,
    };
  }
  return {
    ok: false,
    message:
      `Producción corre ${deployedCommit ?? "un commit desconocido"} y main está en ${tip.sha} ` +
      `desde hace ${minutes} min, con cambios que corren. El deploy no llegó: revisar la ` +
      "corrida de Deploy de ese commit (o relanzarla con `gh workflow run deploy.yml --ref main`).",
  };
}

function gh(args) {
  return JSON.parse(execFileSync("gh", ["api", ...args], { encoding: "utf8" }));
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) throw new Error("Falta GITHUB_REPOSITORY");
  const tip = gh([
    `repos/${repository}/commits/main`,
    "--jq",
    "{sha: .sha, committedAt: .commit.committer.date}",
  ]);
  const verdict = await driftVerdict({
    tip,
    deployedCommit: await productionCommit(),
    compare: (base, head) =>
      gh([
        `repos/${repository}/compare/${base}...${head}`,
        "--jq",
        "{status: .status, files: [.files[].filename]}",
      ]),
  });
  if (verdict.ok) {
    console.log(verdict.message);
    return;
  }
  console.log(`::error::${verdict.message}`);
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
