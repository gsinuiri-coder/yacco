/**
 * `pnpm gcp:bootstrap` — deja el proyecto de Google Cloud listo para recibir
 * despliegues. Idempotente: correrlo dos veces no rompe ni duplica nada.
 *
 * Qué crea, en este orden:
 *   1. el proyecto, si no existe, y lo vincula a la cuenta de facturación;
 *   2. las seis APIs que la migración necesita;
 *   3. el repositorio de Artifact Registry donde vive la imagen;
 *   4. la service account con la que CORRE Cloud Run, con
 *      `secretmanager.secretAccessor` y nada más;
 *   5. la service account con la que DESPLIEGA GitHub Actions;
 *   6. Workload Identity Federation, para que Actions entre sin ninguna llave
 *      de larga vida.
 *
 * Cada paso comprueba antes de crear, con `describe ... --allowFailure`: es lo
 * que lo hace corrible dos veces. Nada de lo que imprime es un secreto.
 */
import { loadConfig, run } from "./lib.mjs";

const REQUIRED_SERVICES = [
  "run.googleapis.com",
  "cloudbuild.googleapis.com",
  "artifactregistry.googleapis.com",
  "secretmanager.googleapis.com",
  "iam.googleapis.com",
  "iamcredentials.googleapis.com",
];

export const ARTIFACT_REPOSITORY = "yacco";
export const RUNTIME_SERVICE_ACCOUNT = "yacco-api-run";
export const DEPLOYER_SERVICE_ACCOUNT = "yacco-deployer";
export const WIF_POOL = "github";
export const WIF_PROVIDER = "github-oidc";

/**
 * Lo mínimo que GitHub Actions necesita para desplegar, y nada más.
 *
 * `run.admin` para actualizar el servicio, `artifactregistry.writer` para
 * empujar la imagen, y `iam.serviceAccountUser` SOBRE la service account de
 * runtime — sin ese último, `gcloud run deploy` falla al intentar asignarle a
 * la revisión una identidad que el que despliega no tiene permiso de usar.
 * Deliberadamente NO lleva `editor` ni `owner`.
 */
const DEPLOYER_PROJECT_ROLES = ["roles/run.admin", "roles/artifactregistry.writer"];

function serviceAccountEmail(name, projectId) {
  return `${name}@${projectId}.iam.gserviceaccount.com`;
}

function log(step, detail) {
  console.log(`  ${step.padEnd(28)} ${detail}`);
}

function ensureProject(projectId, billingAccountId) {
  const existing = run("gcloud", ["projects", "describe", projectId, "--format=value(projectId)"], {
    allowFailure: true,
  });

  if (existing.ok) {
    log("proyecto", `${projectId} ya existe`);
  } else {
    run("gcloud", ["projects", "create", projectId, "--name=yacco"]);
    log("proyecto", `${projectId} creado`);
  }

  const billing = run(
    "gcloud",
    ["billing", "projects", "describe", projectId, "--format=value(billingAccountName)"],
    { allowFailure: true },
  );

  if (billing.ok && billing.stdout.endsWith(billingAccountId)) {
    log("facturación", "ya vinculada");
    return;
  }

  run("gcloud", [
    "billing",
    "projects",
    "link",
    projectId,
    `--billing-account=${billingAccountId}`,
  ]);
  log("facturación", `vinculada a ${billingAccountId}`);
}

function ensureServices(projectId) {
  const enabled = new Set(
    run("gcloud", [
      "services",
      "list",
      "--enabled",
      `--project=${projectId}`,
      "--format=value(config.name)",
    ]).split(/\r?\n/),
  );

  const missing = REQUIRED_SERVICES.filter((service) => !enabled.has(service));
  if (missing.length === 0) {
    log("APIs", "las seis ya estaban habilitadas");
    return;
  }

  // Una sola llamada con todas: habilitarlas de a una multiplica la espera de
  // propagación, que es la parte lenta.
  run("gcloud", ["services", "enable", ...missing, `--project=${projectId}`]);
  log("APIs", `habilitadas ${missing.length} (${missing.map((s) => s.split(".")[0]).join(", ")})`);
}

function ensureArtifactRegistry(projectId, region) {
  const existing = run(
    "gcloud",
    [
      "artifacts",
      "repositories",
      "describe",
      ARTIFACT_REPOSITORY,
      `--location=${region}`,
      `--project=${projectId}`,
      "--format=value(name)",
    ],
    { allowFailure: true },
  );

  if (existing.ok) {
    log("artifact registry", `${ARTIFACT_REPOSITORY} ya existe en ${region}`);
    return;
  }

  run("gcloud", [
    "artifacts",
    "repositories",
    "create",
    ARTIFACT_REPOSITORY,
    "--repository-format=docker",
    `--location=${region}`,
    `--project=${projectId}`,
    "--description=Imagenes de la API de Yacco",
  ]);
  log("artifact registry", `${ARTIFACT_REPOSITORY} creado en ${region}`);
}

function ensureServiceAccount(name, displayName, projectId) {
  const email = serviceAccountEmail(name, projectId);
  const existing = run(
    "gcloud",
    [
      "iam",
      "service-accounts",
      "describe",
      email,
      `--project=${projectId}`,
      "--format=value(email)",
    ],
    { allowFailure: true },
  );

  if (existing.ok) {
    log("service account", `${name} ya existe`);
    return email;
  }

  run("gcloud", [
    "iam",
    "service-accounts",
    "create",
    name,
    `--project=${projectId}`,
    `--display-name=${displayName}`,
  ]);
  log("service account", `${name} creada`);
  return email;
}

/**
 * Añade un rol de proyecto sólo si falta.
 *
 * `add-iam-policy-binding` ya es idempotente, pero comprobar primero deja el
 * log diciendo qué cambió de verdad, que es lo que uno quiere leer cuando
 * corre esto por segunda vez.
 */
function ensureProjectRole(projectId, memberEmail, role) {
  const bindings = run("gcloud", [
    "projects",
    "get-iam-policy",
    projectId,
    "--flatten=bindings[].members",
    `--filter=bindings.role=${role} AND bindings.members=serviceAccount:${memberEmail}`,
    "--format=value(bindings.role)",
  ]);

  if (bindings.length > 0) {
    log("iam", `${role} ya concedido`);
    return;
  }

  run("gcloud", [
    "projects",
    "add-iam-policy-binding",
    projectId,
    `--member=serviceAccount:${memberEmail}`,
    `--role=${role}`,
    "--condition=None",
  ]);
  log("iam", `${role} concedido`);
}

function ensureWorkloadIdentity(projectId, projectNumber, repository, deployerEmail) {
  const poolExists = run(
    "gcloud",
    [
      "iam",
      "workload-identity-pools",
      "describe",
      WIF_POOL,
      "--location=global",
      `--project=${projectId}`,
      "--format=value(name)",
    ],
    { allowFailure: true },
  );

  if (poolExists.ok) {
    log("wif pool", `${WIF_POOL} ya existe`);
  } else {
    run("gcloud", [
      "iam",
      "workload-identity-pools",
      "create",
      WIF_POOL,
      "--location=global",
      `--project=${projectId}`,
      "--display-name=GitHub Actions",
    ]);
    log("wif pool", `${WIF_POOL} creado`);
  }

  const providerExists = run(
    "gcloud",
    [
      "iam",
      "workload-identity-pools",
      "providers",
      "describe",
      WIF_PROVIDER,
      "--location=global",
      `--workload-identity-pool=${WIF_POOL}`,
      `--project=${projectId}`,
      "--format=value(name)",
    ],
    { allowFailure: true },
  );

  // La condición ancla el proveedor a ESTE repositorio. Sin ella, el workflow
  // de cualquier repo de GitHub podría pedir un token contra este proyecto:
  // el emisor es el mismo para todo GitHub.
  const attributeCondition = `assertion.repository == '${repository}'`;

  if (providerExists.ok) {
    run("gcloud", [
      "iam",
      "workload-identity-pools",
      "providers",
      "update-oidc",
      WIF_PROVIDER,
      "--location=global",
      `--workload-identity-pool=${WIF_POOL}`,
      `--project=${projectId}`,
      `--attribute-condition=${attributeCondition}`,
    ]);
    log("wif provider", `${WIF_PROVIDER} actualizado (anclado a ${repository})`);
  } else {
    run("gcloud", [
      "iam",
      "workload-identity-pools",
      "providers",
      "create-oidc",
      WIF_PROVIDER,
      "--location=global",
      `--workload-identity-pool=${WIF_POOL}`,
      `--project=${projectId}`,
      "--issuer-uri=https://token.actions.githubusercontent.com",
      "--attribute-mapping=google.subject=assertion.sub,attribute.repository=assertion.repository",
      `--attribute-condition=${attributeCondition}`,
    ]);
    log("wif provider", `${WIF_PROVIDER} creado (anclado a ${repository})`);
  }

  // Sólo las ejecuciones de ESTE repositorio pueden hacerse pasar por la
  // service account que despliega.
  const principal =
    `principalSet://iam.googleapis.com/projects/${projectNumber}` +
    `/locations/global/workloadIdentityPools/${WIF_POOL}/attribute.repository/${repository}`;

  run("gcloud", [
    "iam",
    "service-accounts",
    "add-iam-policy-binding",
    deployerEmail,
    `--project=${projectId}`,
    `--member=${principal}`,
    "--role=roles/iam.workloadIdentityUser",
  ]);
  log("wif binding", `${repository} habilitado a suplantar al deployer`);

  return `projects/${projectNumber}/locations/global/workloadIdentityPools/${WIF_POOL}/providers/${WIF_PROVIDER}`;
}

function requireConfig(config, keys) {
  const missing = keys.filter((key) => (config[key] ?? "").trim().length === 0);
  if (missing.length > 0) {
    console.error(`Faltan claves: ${missing.join(", ")}`);
    console.error("Completá .env.setup (o exportálas) y corré `pnpm env:check`.");
    process.exit(1);
  }
}

function main() {
  const config = loadConfig();
  requireConfig(config, ["GCP_PROJECT_ID", "GCP_BILLING_ACCOUNT_ID", "GCP_REGION"]);

  const projectId = config.GCP_PROJECT_ID.trim();
  const region = config.GCP_REGION.trim();
  const repository = (config.GITHUB_REPOSITORY ?? "gsinuiri-coder/yacco").trim();

  ensureProject(projectId, config.GCP_BILLING_ACCOUNT_ID.trim());
  ensureServices(projectId);
  ensureArtifactRegistry(projectId, region);

  const runtimeEmail = ensureServiceAccount(
    RUNTIME_SERVICE_ACCOUNT,
    "Cloud Run runtime de la API de Yacco",
    projectId,
  );
  // La identidad con la que corre el servicio: lee secretos y nada más. NO se
  // usa la service account por defecto de Compute Engine, que es Editor sobre
  // todo el proyecto.
  ensureProjectRole(projectId, runtimeEmail, "roles/secretmanager.secretAccessor");

  const deployerEmail = ensureServiceAccount(
    DEPLOYER_SERVICE_ACCOUNT,
    "Despliegue desde GitHub Actions",
    projectId,
  );
  for (const role of DEPLOYER_PROJECT_ROLES) {
    ensureProjectRole(projectId, deployerEmail, role);
  }

  // serviceAccountUser va SOBRE la service account de runtime, no sobre el
  // proyecto: el que despliega puede asignar esa identidad concreta a una
  // revisión, y ninguna otra.
  run("gcloud", [
    "iam",
    "service-accounts",
    "add-iam-policy-binding",
    runtimeEmail,
    `--project=${projectId}`,
    `--member=serviceAccount:${deployerEmail}`,
    "--role=roles/iam.serviceAccountUser",
  ]);
  log("iam", "deployer habilitado a usar la identidad de runtime");

  const projectNumber = run("gcloud", [
    "projects",
    "describe",
    projectId,
    "--format=value(projectNumber)",
  ]);

  const provider = ensureWorkloadIdentity(projectId, projectNumber, repository, deployerEmail);

  console.log("");
  console.log("Listo. Para los secretos del repositorio en GitHub:");
  console.log(`  GCP_WORKLOAD_IDENTITY_PROVIDER = ${provider}`);
  console.log(`  GCP_DEPLOYER_SERVICE_ACCOUNT   = ${deployerEmail}`);
  console.log("");
  console.log("Ninguno de los dos es un secreto: identifican recursos, no autorizan nada");
  console.log("por sí solos. Lo que autoriza es la condición del proveedor, anclada al repo.");
  console.log("");
  console.log("Siguiente paso:  pnpm secrets:gcp");
}

main();
