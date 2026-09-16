/**
 * `pnpm deploy:api` — construye la imagen de la API, la sube a Artifact
 * Registry y la despliega en Cloud Run. Imprime SÓLO la URL del servicio.
 *
 *   pnpm deploy:api --env=demo     servicio yacco-api-demo, rama demo de Neon
 *   pnpm deploy:api --env=production   servicio yacco-api, rama main de Neon
 *
 * Demo es el valor por defecto a propósito: el despliegue a producción tiene
 * que ser algo que alguien escribió, no algo que se le escapó.
 *
 * NO corre migraciones. Eso es un paso propio de CI, contra DIRECT_URL, antes
 * del deploy — nunca al arrancar el contenedor, donde varias instancias las
 * correrían a la vez contra la misma base.
 */
import { loadConfig, run } from "./lib.mjs";

const ENVIRONMENTS = {
  demo: {
    service: "yacco-api-demo",
    // La demo puede arrancar en frío sin que le importe a nadie: no hay una
    // persona esperando la primera pantalla de la mañana.
    minInstances: "0",
    // D-013 en docs/ARQUITECTURA.md: sus llamadores reales son los previews
    // de Vercel, y cada uno nace con una URL única — no hay nada fijo que
    // enumerar acá, así que queda solo el dev local de siempre.
    webOriginDefault: "http://localhost:5173",
  },
  production: {
    service: "yacco-api",
    // Ver P-01 en docs/ARQUITECTURA.md: el arranque en frío medido es de ~4 s,
    // y la primera request del día es justo cuando el dueño abre la app en la
    // planta.
    minInstances: "1",
    // D-013: el alias estable de Vercel (D-011) más el dev local.
    webOriginDefault: "https://yacco-web.vercel.app,http://localhost:5173",
  },
};

const ARTIFACT_REPOSITORY = "yacco";
const RUNTIME_SERVICE_ACCOUNT = "yacco-api-run";
const IMAGE_NAME = "api";

/** Los cuatro secretos que el proceso necesita, montados POR REFERENCIA. */
const SECRET_KEYS = [
  ["DATABASE_URL", "database-url"],
  ["DIRECT_URL", "direct-url"],
  ["JWT_ACCESS_SECRET", "jwt-access-secret"],
  ["JWT_REFRESH_SECRET", "jwt-refresh-secret"],
];

function parseEnvironmentFlag() {
  const flag = process.argv.find((argument) => argument.startsWith("--env="));
  const name = flag === undefined ? "demo" : flag.slice("--env=".length);
  const environment = ENVIRONMENTS[name];
  if (environment === undefined) {
    console.error(`--env desconocido: "${name}". Usá demo o production.`);
    process.exit(1);
  }
  return { name, ...environment };
}

function requireConfig(config, keys) {
  const missing = keys.filter((key) => (config[key] ?? "").trim().length === 0);
  if (missing.length > 0) {
    console.error(`Faltan claves: ${missing.join(", ")}`);
    process.exit(1);
  }
}

/** El sha del commit desplegado, para que /health lo pueda publicar. */
function currentCommit() {
  const result = run("git", ["rev-parse", "HEAD"], { allowFailure: true });
  return result.ok ? result.stdout : "unknown";
}

function main() {
  const config = loadConfig();
  requireConfig(config, ["GCP_PROJECT_ID", "GCP_REGION"]);

  const projectId = config.GCP_PROJECT_ID.trim();
  const region = config.GCP_REGION.trim();
  const environment = parseEnvironmentFlag();
  const commit = currentCommit();

  const registry = `${region}-docker.pkg.dev`;
  const image = `${registry}/${projectId}/${ARTIFACT_REPOSITORY}/${IMAGE_NAME}`;
  // Se etiqueta con el sha Y con el nombre del entorno: el sha deja volver a
  // una revisión concreta, y la etiqueta del entorno deja ver de un vistazo
  // qué está desplegado dónde.
  const taggedImage = `${image}:${commit.slice(0, 12)}`;

  console.error(`Construyendo ${environment.service}...`);
  run("docker", [
    "build",
    "-f",
    "apps/api/Dockerfile",
    "-t",
    taggedImage,
    "-t",
    `${image}:${environment.name}`,
    ".",
  ]);

  // Sin --quiet, esto pregunta por consola y cuelga el script.
  run("gcloud", ["auth", "configure-docker", registry, "--quiet"]);

  console.error("Subiendo la imagen...");
  run("docker", ["push", taggedImage]);
  run("docker", ["push", `${image}:${environment.name}`]);

  const secrets = SECRET_KEYS.map(
    ([variable, suffix]) => `${variable}=yacco-${environment.name}-${suffix}:latest`,
  ).join(",");

  // Configuración en claro: nada de esto es secreto. WEB_ORIGIN default es
  // por entorno (D-013 en docs/ARQUITECTURA.md) — config.WEB_ORIGIN, si
  // alguien lo puso en .env.setup o en el entorno del proceso, sigue
  // pisándolo para los dos, igual que ya hace con los JWT_*_EXPIRES_IN.
  const environmentVariables = [
    `JWT_ACCESS_EXPIRES_IN=${(config.JWT_ACCESS_EXPIRES_IN ?? "15m").trim()}`,
    `JWT_REFRESH_EXPIRES_IN=${(config.JWT_REFRESH_EXPIRES_IN ?? "30d").trim()}`,
    `WEB_ORIGIN=${(config.WEB_ORIGIN ?? environment.webOriginDefault).trim()}`,
    `DEPLOYED_COMMIT=${commit}`,
    // `environment.name` ya es "demo" o "production": los mismos dos valores
    // que env.validation.ts acepta para APP_ENV. Lo que /health expone con
    // esto es el testigo de qué servicio contestó, para verificar P-05 desde
    // el navegador en vez de darlo por hecho.
    `APP_ENV=${environment.name}`,
    // Swagger apagado en los dos entornos. No se pasa "false": el gate de
    // main.ts sólo enciende con exactamente "true", así que ausente ya es
    // apagado, y dejarlo ausente evita que alguien lo "corrija" a mano.
  ].join(",");

  console.error("Desplegando en Cloud Run...");
  run("gcloud", [
    "run",
    "deploy",
    environment.service,
    `--image=${taggedImage}`,
    `--region=${region}`,
    `--project=${projectId}`,
    `--service-account=${RUNTIME_SERVICE_ACCOUNT}@${projectId}.iam.gserviceaccount.com`,
    `--set-secrets=${secrets}`,
    `--set-env-vars=${environmentVariables}`,
    `--min-instances=${environment.minInstances}`,
    "--max-instances=10",
    "--memory=512Mi",
    "--cpu=1",
    // La API es pública: el navegador le pega a través del rewrite de Vercel,
    // sin credenciales de Google. La autorización la hace la propia app.
    "--allow-unauthenticated",
    "--port=8080",
    "--quiet",
  ]);

  const url = run("gcloud", [
    "run",
    "services",
    "describe",
    environment.service,
    `--region=${region}`,
    `--project=${projectId}`,
    "--format=value(status.url)",
  ]);

  // Lo único que va a stdout: así `URL=$(pnpm deploy:api)` sirve de verdad.
  console.log(url);
}

main();
