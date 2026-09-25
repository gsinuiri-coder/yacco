/**
 * `pnpm viewer:bootstrap` — paso MANUAL, fuera de todo camino automático: crea
 * o verifica la cuenta técnica del smoke del deploy en PRODUCCIÓN (rol VIEWER:
 * sólo catálogos y /auth/me) y deja su contraseña en Secret Manager, legible
 * por el deployer de CI. Idempotente.
 *
 *   GCP_PROJECT_ID=yacco-v2-prod pnpm viewer:bootstrap
 *
 * Crear un usuario pide un admin, y ESTE es el único lugar que lo usa. La
 * contraseña del admin la escribe en la terminal la persona que lo corre (sin
 * eco, nunca por argv ni por el entorno): el script no lee el secreto de la
 * contraseña inicial del admin ni ningún otro secreto de admin. Así la
 * rotación de F no rompe nada: el bootstrap pide la contraseña vigente, y el
 * smoke del deploy (`smoke.mjs --require-viewer`) usa SÓLO la de VIEWER.
 * Sin terminal interactiva no corre.
 *
 * Pasos, y por qué en este orden:
 *   1. Login como admin, y buscar `smoke-viewer` entre las cuentas en uso Y
 *      las desactivadas.
 *   2. La contraseña (viewerPlan): la que ya esté en SMOKE_VIEWER_SECRET o,
 *      SÓLO si el secreto no existe (NOT_FOUND) y la cuenta tampoco, una nueva
 *      al azar que va PRIMERO al secreto (por stdin). Si la subida falla, no se
 *      crea ningún usuario con una contraseña que nadie tiene. Cualquier otra
 *      combinación (secreto ilegible, cuenta desactivada, cuenta sin secreto)
 *      aborta sin escribir nada.
 *   3. Si `smoke-viewer` no existe, `POST /users` con roles ["VIEWER"]: el
 *      mismo camino que usa la oficina, con su validación y su hash.
 *   4. Login como la cuenta y el mismo chequeo que corre el smoke
 *      (checkViewerSession): así se sabe que el deploy siguiente va a pasar.
 *   5. `secretAccessor` para el deployer SOBRE ese secreto y ningún otro.
 *
 * Ningún valor se imprime. Las contraseñas viajan a gcloud por stdin y a la API
 * en el cuerpo de la petición, nunca por argv.
 */
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";

import { apiClient, loginAdmin, promptHidden } from "./admin-api.mjs";
import { registerSecret, resolveGcpProject, run } from "./lib.mjs";
import {
  SMOKE_VIEWER_SECRET,
  SMOKE_VIEWER_USERNAME,
  TARGETS,
  checkViewerSession,
} from "./smoke.mjs";

const ADMIN_USERNAME = "admin";
const DEPLOYER_SERVICE_ACCOUNT = "yacco-deployer";
// Mismo tamaño que la contraseña inicial de admin (PROGRESO.md): 192 bits.
const PASSWORD_BYTES = 24;

/** Lo que se le manda a POST /users. El nombre dice qué es a quien lo vea en Usuarios. */
export function viewerUserBody(password) {
  return {
    name: "Verificación automática del sistema",
    username: SMOKE_VIEWER_USERNAME,
    password,
    roles: ["VIEWER"],
  };
}

/** La cuenta del smoke dentro de una lista de GET /users, o null. */
export function findViewer(users) {
  return users.find((user) => user.username === SMOKE_VIEWER_USERNAME) ?? null;
}

/**
 * Qué devolvió `gcloud secrets versions access`. "missing" SÓLO si gcloud dice
 * NOT_FOUND: un permiso denegado, una sesión vencida o una versión
 * deshabilitada son "error", y nunca disparan una contraseña nueva encima de
 * un secreto que quizá está bien.
 */
export function classifySecretRead(result) {
  if (result.ok && result.stdout.length > 0) return { state: "found", value: result.stdout };
  if (!result.ok && /NOT_FOUND/.test(result.stderr)) return { state: "missing" };
  return { state: "error", detail: result.stderr.trim() || "respuesta vacía" };
}

/**
 * Qué hacer según si la cuenta y su secreto existen. Devuelve la acción, o
 * `{ error }` para los dos casos que no se arreglan solos.
 */
export function viewerPlan({ account, secret }) {
  if (secret.state === "error") {
    return { error: `No pude leer ${SMOKE_VIEWER_SECRET}: ${secret.detail}` };
  }
  if (account !== null && !account.active) {
    return {
      error: `${SMOKE_VIEWER_USERNAME} existe pero está desactivada. Reactivarla desde Usuarios.`,
    };
  }
  if (account !== null && secret.state === "missing") {
    return {
      error:
        `${SMOKE_VIEWER_USERNAME} existe pero ${SMOKE_VIEWER_SECRET} no: nadie tiene su ` +
        "contraseña. Cambiársela desde Usuarios no sirve (tiene que quedar en el secreto).",
    };
  }
  return {
    storeNewPassword: secret.state === "missing",
    createAccount: account === null,
  };
}

function readSecret(runCommand, projectId, name) {
  const read = classifySecretRead(
    runCommand(
      "gcloud",
      ["secrets", "versions", "access", "latest", `--secret=${name}`, `--project=${projectId}`],
      { quiet: true, allowFailure: true },
    ),
  );
  if (read.state === "found") registerSecret(read.value);
  return read;
}

function storeNewPassword(runCommand, projectId) {
  const password = randomBytes(PASSWORD_BYTES).toString("base64url");
  registerSecret(password);
  const exists = runCommand(
    "gcloud",
    ["secrets", "describe", SMOKE_VIEWER_SECRET, `--project=${projectId}`, "--format=value(name)"],
    { allowFailure: true },
  );
  if (!exists.ok) {
    runCommand("gcloud", [
      "secrets",
      "create",
      SMOKE_VIEWER_SECRET,
      `--project=${projectId}`,
      "--replication-policy=automatic",
    ]);
  }
  runCommand(
    "gcloud",
    ["secrets", "versions", "add", SMOKE_VIEWER_SECRET, `--project=${projectId}`, "--data-file=-"],
    { input: password },
  );
  // Leída de vuelta: lo que se usa para crear el usuario es lo que quedó
  // guardado, no lo que se creyó mandar.
  const stored = readSecret(runCommand, projectId, SMOKE_VIEWER_SECRET);
  if (stored.value !== password) {
    throw new Error(
      `${SMOKE_VIEWER_SECRET} no devolvió lo que se subió. No se creó ningún usuario.`,
    );
  }
  return password;
}

/**
 * El bootstrap entero, con sus dependencias inyectables para el test. La
 * contraseña del admin llega como argumento: de dónde sale es cosa de `main`
 * (la terminal), nunca de Secret Manager.
 */
export async function bootstrapViewer({
  projectId,
  adminPassword,
  baseUrl = TARGETS.apis.production,
  run: runCommand = run,
  fetch: fetchImpl = fetch,
  log = console.log,
}) {
  registerSecret(adminPassword);
  const api = apiClient(baseUrl, fetchImpl);
  const login = (username, password) =>
    api("/auth/login", { method: "POST", body: { username, password } });

  const adminToken = await loginAdmin(api, adminPassword, ADMIN_USERNAME);

  // En uso Y desactivadas: GET /users trae sólo las activas si no se le dice.
  let account = null;
  for (const active of ["true", "false"]) {
    const users = await api(`/users?role=VIEWER&active=${active}`, { token: adminToken });
    if (users.status !== 200) throw new Error(`GET /users devolvió ${users.status}.`);
    account ??= findViewer(users.body);
  }

  const secret = readSecret(runCommand, projectId, SMOKE_VIEWER_SECRET);
  const plan = viewerPlan({ account, secret });
  if (plan.error !== undefined) throw new Error(plan.error);
  const password = plan.storeNewPassword ? storeNewPassword(runCommand, projectId) : secret.value;
  log(`${SMOKE_VIEWER_SECRET}: ${plan.storeNewPassword ? "creado" : "ya existía"}`);

  if (plan.createAccount) {
    const created = await api("/users", {
      token: adminToken,
      method: "POST",
      body: viewerUserBody(password),
    });
    if (created.status !== 201) throw new Error(`POST /users devolvió ${created.status}.`);
    log(`${SMOKE_VIEWER_USERNAME}: creado con rol VIEWER`);
  } else {
    log(`${SMOKE_VIEWER_USERNAME}: ya existía`);
  }

  const viewer = await login(SMOKE_VIEWER_USERNAME, password);
  const checks = { login: viewer };
  if (viewer.status === 200) {
    const token = viewer.body.accessToken;
    checks.me = await api("/auth/me", { token });
    checks.catalog = await api("/products", { token });
    checks.customers = await api("/customers", { token });
  }
  const problems = checkViewerSession(checks);
  if (problems.length > 0) {
    throw new Error(
      `La cuenta NO pasa el chequeo del smoke:\n${problems.map((p) => `  - ${p}`).join("\n")}`,
    );
  }
  log(`${SMOKE_VIEWER_USERNAME}: pasa el chequeo del smoke`);

  runCommand("gcloud", [
    "secrets",
    "add-iam-policy-binding",
    SMOKE_VIEWER_SECRET,
    `--project=${projectId}`,
    `--member=serviceAccount:${DEPLOYER_SERVICE_ACCOUNT}@${projectId}.iam.gserviceaccount.com`,
    "--role=roles/secretmanager.secretAccessor",
    "--condition=None",
  ]);
  log(`${SMOKE_VIEWER_SECRET}: legible por el deployer de CI`);
  log("Ningún valor se imprimió.");
}

async function main() {
  const projectId = resolveGcpProject(process.env);
  const adminPassword = await promptHidden(
    `Contraseña ACTUAL del usuario ${ADMIN_USERNAME} de producción (no se muestra): `,
  );
  await bootstrapViewer({ projectId, adminPassword });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
