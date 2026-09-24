/**
 * `pnpm smoke:viewer` — crea la cuenta técnica del smoke del deploy en
 * PRODUCCIÓN (rol VIEWER: sólo catálogos y /auth/me) y deja su contraseña en
 * Secret Manager, legible por el deployer de CI. Idempotente.
 *
 *   GCP_PROJECT_ID=yacco-v2-prod pnpm smoke:viewer
 *
 * Pasos, y por qué en este orden:
 *   1. La contraseña: la que ya esté en SMOKE_VIEWER_SECRET o, si no hay, una
 *      nueva al azar que va PRIMERO al secreto (por stdin). Si la subida falla,
 *      no se crea ningún usuario con una contraseña que nadie tiene.
 *   2. Login como admin con `yacco-admin-initial-password`.
 *   3. Si `smoke-viewer` no existe, `POST /users` con roles ["VIEWER"]: el
 *      mismo camino que usa la oficina, con su validación y su hash.
 *   4. Login como la cuenta nueva y el mismo chequeo que corre el smoke
 *      (checkViewerSession): así se sabe que el deploy siguiente va a pasar.
 *   5. `secretAccessor` para el deployer SOBRE ese secreto y ningún otro.
 *
 * Ningún valor se imprime. Las contraseñas viajan a gcloud por stdin y a la API
 * en el cuerpo de la petición, nunca por argv.
 */
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";

import { registerSecret, run } from "./lib.mjs";
import {
  SMOKE_VIEWER_SECRET,
  SMOKE_VIEWER_USERNAME,
  TARGETS,
  checkViewerSession,
} from "./smoke.mjs";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD_SECRET = "yacco-admin-initial-password";
const DEPLOYER_SERVICE_ACCOUNT = "yacco-deployer";
// Mismo tamaño que la contraseña inicial de admin (PROGRESO.md): 192 bits.
const PASSWORD_BYTES = 24;

/** Lo que se le manda a POST /users. El nombre dice qué es a quien lo vea en Usuarios. */
export function viewerUserBody(password) {
  return {
    name: "Verificación del deploy",
    username: SMOKE_VIEWER_USERNAME,
    password,
    roles: ["VIEWER"],
  };
}

/** La cuenta existe si GET /users la trae, con cualquier rol y en uso o no. */
export function findViewer(users) {
  return users.find((user) => user.username === SMOKE_VIEWER_USERNAME) ?? null;
}

function readSecret(projectId, name) {
  const result = run(
    "gcloud",
    ["secrets", "versions", "access", "latest", `--secret=${name}`, `--project=${projectId}`],
    { quiet: true, allowFailure: true },
  );
  return result.ok && result.stdout.length > 0 ? result.stdout : null;
}

function storeNewPassword(projectId) {
  const password = randomBytes(PASSWORD_BYTES).toString("base64url");
  registerSecret(password);
  const exists = run(
    "gcloud",
    ["secrets", "describe", SMOKE_VIEWER_SECRET, `--project=${projectId}`, "--format=value(name)"],
    { allowFailure: true },
  );
  if (!exists.ok) {
    run("gcloud", [
      "secrets",
      "create",
      SMOKE_VIEWER_SECRET,
      `--project=${projectId}`,
      "--replication-policy=automatic",
    ]);
  }
  run(
    "gcloud",
    ["secrets", "versions", "add", SMOKE_VIEWER_SECRET, `--project=${projectId}`, "--data-file=-"],
    { input: password },
  );
  // Leída de vuelta: lo que se usa para crear el usuario es lo que quedó
  // guardado, no lo que se creyó mandar.
  const stored = readSecret(projectId, SMOKE_VIEWER_SECRET);
  if (stored !== password) {
    throw new Error(
      `${SMOKE_VIEWER_SECRET} no devolvió lo que se subió. No se creó ningún usuario.`,
    );
  }
  return password;
}

async function api(baseUrl, path, { token, method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers: {
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // El status alcanza para decidir.
  }
  return { status: response.status, body: json };
}

async function login(baseUrl, username, password) {
  const response = await api(baseUrl, "/auth/login", {
    method: "POST",
    body: { username, password },
  });
  return { status: response.status, body: response.body };
}

async function main() {
  const projectId = (process.env.GCP_PROJECT_ID ?? "").trim();
  if (projectId.length === 0) {
    console.error("Falta GCP_PROJECT_ID (yacco-v2-prod).");
    process.exit(1);
  }
  const baseUrl = TARGETS.apis.production;

  const existing = readSecret(projectId, SMOKE_VIEWER_SECRET);
  if (existing !== null) registerSecret(existing);
  const password = existing ?? storeNewPassword(projectId);
  console.log(`${SMOKE_VIEWER_SECRET}: ${existing === null ? "creado" : "ya existía"}`);

  const adminPassword = readSecret(projectId, ADMIN_PASSWORD_SECRET);
  if (adminPassword === null) throw new Error(`No pude leer ${ADMIN_PASSWORD_SECRET}.`);
  registerSecret(adminPassword);
  const admin = await login(baseUrl, ADMIN_USERNAME, adminPassword);
  if (admin.status !== 200) throw new Error(`El login de admin devolvió ${admin.status}.`);
  const adminToken = admin.body.accessToken;

  const users = await api(baseUrl, "/users?role=VIEWER", { token: adminToken });
  if (users.status !== 200) throw new Error(`GET /users devolvió ${users.status}.`);
  if (findViewer(users.body) === null) {
    const created = await api(baseUrl, "/users", {
      token: adminToken,
      method: "POST",
      body: viewerUserBody(password),
    });
    if (created.status !== 201) throw new Error(`POST /users devolvió ${created.status}.`);
    console.log(`${SMOKE_VIEWER_USERNAME}: creado con rol VIEWER`);
  } else {
    console.log(`${SMOKE_VIEWER_USERNAME}: ya existía`);
  }

  const viewer = await login(baseUrl, SMOKE_VIEWER_USERNAME, password);
  const checks = { login: viewer };
  if (viewer.status === 200) {
    const token = viewer.body.accessToken;
    checks.me = await api(baseUrl, "/auth/me", { token });
    checks.catalog = await api(baseUrl, "/products", { token });
    checks.customers = await api(baseUrl, "/customers", { token });
  }
  const problems = checkViewerSession(checks);
  if (problems.length > 0) {
    console.error("La cuenta NO pasa el chequeo del smoke:");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log(`${SMOKE_VIEWER_USERNAME}: pasa el chequeo del smoke`);

  run("gcloud", [
    "secrets",
    "add-iam-policy-binding",
    SMOKE_VIEWER_SECRET,
    `--project=${projectId}`,
    `--member=serviceAccount:${DEPLOYER_SERVICE_ACCOUNT}@${projectId}.iam.gserviceaccount.com`,
    "--role=roles/secretmanager.secretAccessor",
    "--condition=None",
  ]);
  console.log(`${SMOKE_VIEWER_SECRET}: legible por el deployer de CI`);
  console.log("Ningún valor se imprimió.");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
