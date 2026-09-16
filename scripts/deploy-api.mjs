/**
 * `pnpm deploy:api` — construye la imagen de la API, la sube a Artifact
 * Registry y la despliega en Cloud Run. Imprime SÓLO lo que otro paso necesita
 * leer: la referencia de la imagen o la URL del servicio.
 *
 * Tres formas, y las tres pasan por las MISMAS funciones de abajo:
 *
 *   pnpm deploy:api --env=demo                  build + push + deploy (a mano)
 *   pnpm deploy:api --env=production            ídem, a producción
 *   node scripts/deploy-api.mjs build           sólo build + push; imprime la imagen
 *   node scripts/deploy-api.mjs deploy --env=demo --image=<ref>
 *                                               sólo deploy de una imagen ya subida
 *
 * Las dos últimas son las que usa CI (.github/workflows/deploy.yml): construye
 * UNA imagen y la despliega primero a demo y, si demo queda sana, la MISMA a
 * producción. Por eso build y deploy están separados, y por eso son el mismo
 * código que se corre a mano: no hay un segundo camino de build (ni
 * `gcloud run deploy --source` ni buildpacks) que pueda producir una imagen
 * distinta de la que se probó. Ver D-014 en docs/ARQUITECTURA.md.
 *
 * Demo es el valor por defecto a propósito: el despliegue a producción tiene
 * que ser algo que alguien escribió, no algo que se le escapó.
 *
 * NO corre migraciones. Eso es un paso propio de CI, contra DIRECT_URL, antes
 * del deploy — nunca al arrancar el contenedor, donde varias instancias las
 * correrían a la vez contra la misma base.
 */
import { pathToFileURL } from "node:url";
import { loadConfig, run } from "./lib.mjs";

export const ENVIRONMENTS = {
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

// Largo del sha en la etiqueta de la imagen: el mismo que ya tienen las
// imágenes subidas en la fase 3, para que las etiquetas viejas y las nuevas se
// lean igual en Artifact Registry.
const IMAGE_TAG_LENGTH = 12;

/** Los cuatro secretos que el proceso necesita, montados POR REFERENCIA. */
const SECRET_KEYS = [
  ["DATABASE_URL", "database-url"],
  ["DIRECT_URL", "direct-url"],
  ["JWT_ACCESS_SECRET", "jwt-access-secret"],
  ["JWT_REFRESH_SECRET", "jwt-refresh-secret"],
];

/**
 * Lee `build` / `deploy` y los flags. Sin subcomando es el camino a mano de
 * siempre: build + push + deploy de una vez.
 *
 * Devuelve `{ error }` en vez de salir del proceso, para que se pueda probar.
 */
export function parseArgs(argv) {
  const positional = argv.filter((argument) => !argument.startsWith("--"));
  const flag = (name) => {
    const found = argv.find((argument) => argument.startsWith(`--${name}=`));
    return found === undefined ? undefined : found.slice(`--${name}=`.length);
  };

  const command = positional[0] ?? "all";
  if (!["all", "build", "deploy"].includes(command)) {
    return { error: `Subcomando desconocido: "${command}". Usá build, deploy, o ninguno.` };
  }

  const envName = flag("env") ?? "demo";
  if (command !== "build" && ENVIRONMENTS[envName] === undefined) {
    return { error: `--env desconocido: "${envName}". Usá demo o production.` };
  }

  const image = flag("image");
  if (command === "deploy" && (image === undefined || image.length === 0)) {
    return { error: "`deploy` necesita --image=<referencia completa de la imagen ya subida>." };
  }

  return { command, envName, image };
}

export function imageRepository(region, projectId) {
  return `${region}-docker.pkg.dev/${projectId}/${ARTIFACT_REPOSITORY}/${IMAGE_NAME}`;
}

export function imageTagFor(commit) {
  return commit.slice(0, IMAGE_TAG_LENGTH);
}

/**
 * Una imagen sólo se despliega con el commit del que salió.
 *
 * `/health` publica DEPLOYED_COMMIT para poder creerle cuando difiere de
 * `main` (D-009). Si se desplegara la imagen de un commit reportando otro, ese
 * campo mentiría justo en el caso en que alguien lo mira. Y deja afuera, por
 * construcción, desplegar por cualquier etiqueta que no sea el sha —como la
 * vieja `:demo` de la fase 3, que ningún deploy vuelve a mover (ver
 * deployCommands)—: se despliega siempre la imagen del commit.
 */
export function assertImageMatchesCommit(imageRef, commit) {
  const expectedSuffix = `:${imageTagFor(commit)}`;
  if (!imageRef.endsWith(expectedSuffix)) {
    throw new Error(
      `La imagen ${imageRef} no es la del commit ${commit} (se esperaba la etiqueta ${expectedSuffix}). ` +
        "No se despliega una imagen con el commit de otra.",
    );
  }
}

function requireConfig(config, keys) {
  const missing = keys.filter((key) => (config[key] ?? "").trim().length === 0);
  if (missing.length > 0) {
    console.error(`Faltan claves: ${missing.join(", ")}`);
    process.exit(1);
  }
}

/**
 * El sha del commit desplegado, para que /health lo pueda publicar.
 *
 * Sin repositorio no hay commit que informar, y se para: un valor inventado
 * ("unknown") dejaría a /health diciendo algo que nadie puede comparar contra
 * `main`, y a assertImageMatchesCommit sin nada contra qué comparar.
 */
function currentCommit() {
  const result = run("git", ["rev-parse", "HEAD"], { allowFailure: true });
  if (!result.ok || !/^[0-9a-f]{40}$/.test(result.stdout)) {
    throw new Error("No pude leer el commit actual con `git rev-parse HEAD`.");
  }
  return result.stdout;
}

/** Construye la imagen desde la raíz del monorepo y la sube. Devuelve la referencia. */
export function buildAndPush({ projectId, region, commit }) {
  const registry = `${region}-docker.pkg.dev`;
  const imageRef = `${imageRepository(region, projectId)}:${imageTagFor(commit)}`;

  console.error(`Construyendo ${imageRef}...`);
  run("docker", ["build", "-f", "apps/api/Dockerfile", "-t", imageRef, "."]);

  // Sin --quiet, esto pregunta por consola y cuelga el script.
  run("gcloud", ["auth", "configure-docker", registry, "--quiet"]);

  console.error("Subiendo la imagen...");
  run("docker", ["push", imageRef]);

  return imageRef;
}

/**
 * Los comandos de `gcloud` que CAMBIAN algo al desplegar, en orden. Separados
 * de su ejecución para poder probar qué hace y qué no hace un deploy.
 *
 * Deliberadamente NO etiqueta la imagen con el nombre del entorno (`:demo`,
 * `:production`). Lo hacía hasta el primer deploy desde CI (2026-09-16), y ahí
 * falló: mover una etiqueta existente exige `artifactregistry.tags.delete`, que
 * el deployer no tiene por diseño. Se sacó en vez de ampliar permisos, porque
 * la etiqueta no servía para nada y además mentía: nada desplegaba por ella
 * (ver assertImageMatchesCommit), y la `:demo` de ese día apuntaba a una imagen
 * vieja. Qué está desplegado lo dicen el `commit` de /health y la revisión de
 * Cloud Run. Ver D-014 antes de reponerla "para tener visibilidad".
 */
export function deployCommands({ projectId, region, config, envName, imageRef, commit }) {
  const environment = ENVIRONMENTS[envName];

  const secrets = SECRET_KEYS.map(
    ([variable, suffix]) => `${variable}=yacco-${envName}-${suffix}:latest`,
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
    // `envName` ya es "demo" o "production": los mismos dos valores que
    // env.validation.ts acepta para APP_ENV. Lo que /health expone con esto es
    // el testigo de qué servicio contestó, y `pnpm smoke:prod` FALLA si vuelve
    // null — ver scripts/smoke.mjs.
    `APP_ENV=${envName}`,
    // Swagger apagado en los dos entornos. No se pasa "false": el gate de
    // main.ts sólo enciende con exactamente "true", así que ausente ya es
    // apagado, y dejarlo ausente evita que alguien lo "corrija" a mano.
  ].join(",");

  return [
    [
      "run",
      "deploy",
      environment.service,
      `--image=${imageRef}`,
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
    ],
  ];
}

/** Despliega una imagen ya subida en el servicio del entorno. Devuelve la URL. */
export function deployImage({ projectId, region, config, envName, imageRef, commit }) {
  assertImageMatchesCommit(imageRef, commit);
  const environment = ENVIRONMENTS[envName];

  console.error(`Desplegando ${environment.service} en Cloud Run...`);
  for (const args of deployCommands({ projectId, region, config, envName, imageRef, commit })) {
    run("gcloud", args);
  }

  return run("gcloud", [
    "run",
    "services",
    "describe",
    environment.service,
    `--region=${region}`,
    `--project=${projectId}`,
    "--format=value(status.url)",
  ]);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error !== undefined) {
    console.error(args.error);
    process.exit(1);
  }

  const config = loadConfig();
  requireConfig(config, ["GCP_PROJECT_ID", "GCP_REGION"]);
  const projectId = config.GCP_PROJECT_ID.trim();
  const region = config.GCP_REGION.trim();
  const commit = currentCommit();

  if (args.command === "build") {
    // Lo único que va a stdout: así `IMAGE=$(node scripts/deploy-api.mjs build)` sirve.
    console.log(buildAndPush({ projectId, region, commit }));
    return;
  }

  const imageRef =
    args.command === "deploy" ? args.image : buildAndPush({ projectId, region, commit });

  const url = deployImage({ projectId, region, config, envName: args.envName, imageRef, commit });
  // Lo único que va a stdout: así `URL=$(pnpm deploy:api)` sirve de verdad.
  console.log(url);
}

// Sólo corre como programa, no al importarlo desde el test.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
