/**
 * `pnpm smoke:prod` — comprueba que lo desplegado está vivo, de SOLO LECTURA.
 *
 * Nada de lo que hace escribe en ninguna base. La única credencial que usa es
 * la de la cuenta `smoke-viewer` (rol VIEWER: sólo catálogos y /auth/me), por
 * SMOKE_VIEWER_PASSWORD; sin ella, el paso 5 no corre y lo avisa.
 *
 *   pnpm smoke:prod                              todo, contra lo público
 *   node scripts/smoke.mjs api --env=demo        sólo una API (el gate de CI
 *   node scripts/smoke.mjs api --env=production  después de cada deploy)
 *
 * Qué comprueba `smoke:prod`:
 *   1. /health de las DOS APIs de Cloud Run, directo: status ok, el commit
 *      esperado y el `environment` que les corresponde. `environment: null`
 *      FALLA: un servicio sin APP_ENV deja sin testigo a P-05.
 *   2. /health a través del dominio de producción de Vercel: tiene que decir
 *      "production". Es la mitad automatizable de la verificación de P-05 —
 *      prueba el rewrite de host de verdad, no una copia de sus reglas.
 *   3. Un login que TIENE que fallar (401), a través de Vercel. Ver
 *      checkRejectedLogin.
 *   4. Las pantallas principales del web: el HTML del Nuxt (D-023) en `/`,
 *      `/login` y una ruta profunda, con los headers anti-enmarcado (A6), y el
 *      módulo de entrada `/_nuxt/*.js` que ese HTML referencia. Una página
 *      servida por el web React (`<div id="root">`, `/assets/*.js`) FALLA: es
 *      lo que distingue si el corte ocurrió.
 *   5. Con SMOKE_VIEWER_PASSWORD: un login VÁLIDO de `smoke-viewer` por el
 *      dominio de producción, GET /auth/me y /products, y 403 en /customers.
 *      Ver checkViewerSession.
 *
 * Si EXPECTED_COMMIT está en el entorno (CI la pone), el commit de cada API
 * tiene que coincidir. Sin ella (a mano) se comprueba todo lo demás.
 */
import { pathToFileURL } from "node:url";

// URLs deterministas de Cloud Run (formato SERVICE-PROJECT_NUMBER.REGION), las
// mismas que usa apps/web-nuxt/config/api-proxy.ts: ver D-012 y D-021 en
// docs/ARQUITECTURA.md. La guardia de deploy-web.mjs las compara contra el build.
export const TARGETS = {
  apis: {
    demo: "https://yacco-api-demo-297699663114.us-east4.run.app",
    production: "https://yacco-api-297699663114.us-east4.run.app",
  },
  web: "https://yacco-web.vercel.app",
};

// Usuario claramente sintético: `.invalid` es un TLD reservado (RFC 2606),
// así que nadie lo confunde con una persona al leer los logs de la API.
export const SYNTHETIC_LOGIN = {
  username: "smoke-check@invalid",
  password: "smoke-check-not-a-password",
};

// La demo tiene min-instances=0 (D-008): la primera petición paga un arranque
// en frío de ~6 s. El margen es para eso, no para tolerar una API lenta.
const REQUEST_TIMEOUT_MS = 30_000;

// Las rutas del web que se cargan. `/customers/new` es una ruta profunda que
// existe en apps/web-nuxt/app/pages: el SSR la tiene que renderizar, y una
// ruta que no existe daría 404 (Nuxt no tiene fallback a index.html).
export const WEB_SCREENS = ["/", "/login", "/customers/new"];

/**
 * Evalúa el cuerpo de /health. Devuelve la lista de problemas; vacía = sano.
 */
export function checkHealth(body, { expectedEnvironment, expectedCommit }) {
  const problems = [];
  if (body === null || typeof body !== "object") {
    return ["/health no devolvió un objeto JSON"];
  }
  if (body.status !== "ok") {
    problems.push(`status es ${JSON.stringify(body.status)}, se esperaba "ok"`);
  }

  if (body.environment === null || body.environment === undefined) {
    // El caso que motivó el campo (PR #131): un servicio desplegado sin
    // APP_ENV. No es un detalle: sin este valor no hay forma de saber desde
    // afuera qué API contestó, y P-05 queda sin testigo.
    problems.push(
      "environment es null: el servicio quedó desplegado SIN APP_ENV. " +
        "P-05 no tiene testigo hasta que se redespliegue con scripts/deploy-api.mjs.",
    );
  } else if (body.environment !== expectedEnvironment) {
    problems.push(
      `environment es ${JSON.stringify(body.environment)}, se esperaba "${expectedEnvironment}"`,
    );
  }

  if (expectedCommit !== undefined && body.commit !== expectedCommit) {
    problems.push(
      `commit es ${JSON.stringify(body.commit)}, se esperaba ${expectedCommit}: ` +
        "lo desplegado no es lo que se acaba de construir",
    );
  }
  return problems;
}

/**
 * Un login con un usuario que no existe tiene que dar 401.
 *
 * Prueba la cadena entera sin guardar ninguna credencial: la API viva, la
 * ruta montada bajo /api/v1, el ValidationPipe, la consulta a Neon
 * (`AuthService.login` busca al usuario ANTES de rechazar) y el filtro de
 * excepciones. No escribe nada. Lo que NO prueba es que un login válido
 * funcione; eso se acepta porque env.validation.ts ya frena el arranque si
 * faltan los secretos de JWT, así que un servicio que responde los tiene.
 *
 * OJO: esto corre en cada deploy. Hoy la API no tiene throttling ni bloqueo
 * por intentos fallidos, así que no bloquea a nadie. Si algún día se agrega
 * rate limiting al login, ESTE PASO HAY QUE REVISARLO: podría dejar bloqueada
 * la IP de los runners, o contar contra un límite compartido.
 */
export function checkRejectedLogin(status) {
  if (status === 401) return [];
  if (status === 404) {
    return [
      "el login devolvió 404: la ruta /api/v1/auth/login no está montada o el rewrite no llega",
    ];
  }
  return [`el login con un usuario inexistente devolvió ${status}, se esperaba 401`];
}

// La cuenta técnica del smoke (ítem 3 de docs/plan-endurecimiento.md). Rol
// VIEWER: lee los catálogos y /auth/me, nada más. La contraseña vive en
// Secret Manager (SMOKE_VIEWER_SECRET) y llega por el entorno, nunca por argv.
export const SMOKE_VIEWER_USERNAME = "smoke-viewer";
export const SMOKE_VIEWER_SECRET = "yacco-production-smoke-viewer-password";

/**
 * Un login VÁLIDO de punta a punta, con la cuenta VIEWER. Recibe los status (y
 * el cuerpo de /auth/me) de las cuatro peticiones:
 *
 *   login      200 con accessToken: la contraseña, el hash y la firma del JWT
 *   me         200 y roles EXACTAMENTE ["VIEWER"]: el token se acepta
 *   catalog    200 en GET /products: un GET autenticado que lee la base
 *   customers  403: la cuenta sigue siendo de solo catálogos. Si alguien le
 *              agregara un rol, el smoke lo ve en el deploy siguiente.
 */
export function checkViewerSession({ login, me, catalog, customers }) {
  if (login.status !== 200 || typeof login.body?.accessToken !== "string") {
    return [`el login de ${SMOKE_VIEWER_USERNAME} devolvió ${login.status}, se esperaba 200`];
  }
  const problems = [];
  if (me.status !== 200) {
    problems.push(`GET /auth/me devolvió ${me.status}, se esperaba 200`);
  } else if (JSON.stringify(me.body?.roles) !== JSON.stringify(["VIEWER"])) {
    problems.push(
      `${SMOKE_VIEWER_USERNAME} tiene roles ${JSON.stringify(me.body?.roles)}: ` +
        'tiene que ser SOLO ["VIEWER"], su contraseña la lee CI',
    );
  }
  if (catalog.status !== 200) {
    problems.push(`GET /products devolvió ${catalog.status}, se esperaba 200`);
  }
  if (customers.status !== 403) {
    problems.push(
      `GET /customers devolvió ${customers.status} para ${SMOKE_VIEWER_USERNAME}, se esperaba 403`,
    );
  }
  return problems;
}

/**
 * El HTML del web Nuxt. Devuelve los problemas y la ruta del módulo de
 * entrada, para comprobar que el JavaScript también se sirve (un HTML sin su
 * JavaScript es una pantalla que da 200 y no hidrata).
 */
export function checkNuxtShell(html) {
  const problems = [];
  if (!html.includes('<div id="__nuxt"')) {
    problems.push('el HTML no tiene <div id="__nuxt">: no lo sirve el web Nuxt');
  }
  const match = /<script[^>]+src="(\/_nuxt\/[^"]+\.js)"/.exec(html);
  if (match === null) {
    problems.push("el HTML no referencia ningún módulo en /_nuxt/*.js");
    return { problems, entryPath: null };
  }
  return { problems, entryPath: match[1] };
}

/** A6: nadie enmarca la app. Recibe los headers de la respuesta (`Headers`). */
export function checkFrameHeaders(headers) {
  const problems = [];
  if (headers.get("x-frame-options") !== "DENY") {
    problems.push("falta X-Frame-Options: DENY");
  }
  if (!(headers.get("content-security-policy") ?? "").includes("frame-ancestors 'none'")) {
    problems.push("falta Content-Security-Policy: frame-ancestors 'none'");
  }
  return problems;
}

async function request(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    contentType: response.headers.get("content-type") ?? "",
    text,
  };
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function smokeHealth(label, baseUrl, expectedEnvironment, expectedCommit) {
  const response = await request(`${baseUrl}/health`);
  if (response.status !== 200) {
    return [`${label}: /health devolvió ${response.status}`];
  }
  return checkHealth(parseJson(response.text), { expectedEnvironment, expectedCommit }).map(
    (problem) => `${label}: ${problem}`,
  );
}

async function smokeRejectedLogin(label, baseUrl) {
  const response = await request(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(SYNTHETIC_LOGIN),
  });
  return checkRejectedLogin(response.status).map((problem) => `${label}: ${problem}`);
}

async function smokeViewerSession(label, baseUrl, password) {
  const login = await request(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: SMOKE_VIEWER_USERNAME, password }),
  });
  const loginBody = parseJson(login.text);
  const token = loginBody?.accessToken;
  const authorized = (path) =>
    request(`${baseUrl}/api/v1${path}`, { headers: { authorization: `Bearer ${token}` } });

  const checks = { login: { status: login.status, body: loginBody } };
  if (login.status === 200 && typeof token === "string") {
    const me = await authorized("/auth/me");
    checks.me = { status: me.status, body: parseJson(me.text) };
    checks.catalog = await authorized("/products");
    checks.customers = await authorized("/customers");
  }
  return checkViewerSession(checks).map((problem) => `${label}: ${problem}`);
}

export async function smokeWebScreens(baseUrl) {
  const problems = [];
  let entryPath = null;
  for (const path of WEB_SCREENS) {
    const response = await request(`${baseUrl}${path}`);
    if (response.status !== 200) {
      problems.push(`web ${path}: devolvió ${response.status}`);
      continue;
    }
    const shell = checkNuxtShell(response.text);
    const pageProblems = [...shell.problems, ...checkFrameHeaders(response.headers)];
    problems.push(...pageProblems.map((problem) => `web ${path}: ${problem}`));
    entryPath ??= shell.entryPath;
  }

  if (entryPath !== null) {
    const entry = await request(`${baseUrl}${entryPath}`);
    if (entry.status !== 200 || !entry.contentType.includes("javascript")) {
      problems.push(`web ${entryPath}: devolvió ${entry.status} (${entry.contentType})`);
    }
  }
  return problems;
}

/** Una sola API, directo a Cloud Run. Es el gate de CI después de cada deploy. */
export async function smokeApi(envName, expectedCommit) {
  const baseUrl = TARGETS.apis[envName];
  const label = `api ${envName}`;
  return [
    ...(await smokeHealth(label, baseUrl, envName, expectedCommit)),
    ...(await smokeRejectedLogin(label, baseUrl)),
  ];
}

/**
 * Todo: las dos APIs directas, y el web con su rewrite. Con la contraseña de
 * la cuenta VIEWER (SMOKE_VIEWER_PASSWORD), además un login válido y GETs
 * autenticados por el dominio de producción.
 */
export async function smokeProduction(expectedCommit, viewerPassword) {
  const viewer =
    viewerPassword === undefined
      ? []
      : await smokeViewerSession("web sesión VIEWER", TARGETS.web, viewerPassword);
  return [
    ...viewer,
    ...(await smokeHealth("api demo", TARGETS.apis.demo, "demo", expectedCommit)),
    ...(await smokeHealth("api production", TARGETS.apis.production, "production", expectedCommit)),
    // Por Vercel: si el rewrite de host mandara producción a demo, esto lo ve.
    ...(await smokeHealth("web /health", TARGETS.web, "production", expectedCommit)),
    ...(await smokeRejectedLogin("web /api", TARGETS.web)),
    ...(await smokeWebScreens(TARGETS.web)),
  ];
}

async function main() {
  const argv = process.argv.slice(2);
  const expectedCommit = (process.env.EXPECTED_COMMIT ?? "").trim() || undefined;

  let problems;
  if (argv[0] === "api") {
    const envFlag = argv.find((argument) => argument.startsWith("--env="));
    const envName = envFlag?.slice("--env=".length);
    if (TARGETS.apis[envName] === undefined) {
      console.error("Uso: node scripts/smoke.mjs api --env=demo|production");
      process.exit(1);
    }
    problems = await smokeApi(envName, expectedCommit);
  } else {
    const viewerPassword = (process.env.SMOKE_VIEWER_PASSWORD ?? "").trim() || undefined;
    if (viewerPassword === undefined) {
      console.log(
        `Sin SMOKE_VIEWER_PASSWORD: el login válido de ${SMOKE_VIEWER_USERNAME} NO se probó.`,
      );
    }
    problems = await smokeProduction(expectedCommit, viewerPassword);
  }

  if (problems.length > 0) {
    console.error("Smoke FALLÓ:");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log("Smoke OK.");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(`Smoke FALLÓ: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
