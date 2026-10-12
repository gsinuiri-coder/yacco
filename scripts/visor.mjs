/**
 * `scripts/visor.mjs` — Administra el visor de Yacco en la carpeta hermana ../v2-visor.
 *
 * El visor corre en una copia separada del repositorio para que la persona
 * pueda probar y explorar la aplicación sin interferir con las corridas
 * locales del relevo ni con sus puertos y bases de datos.
 *
 * Puertos del visor:
 *   - Base de datos (Postgres): 5442
 *   - Almacenamiento (MinIO): 9010 (API) y 9011 (Consola)
 *   - API: 3300
 *   - Web: 3301
 *
 * Comandos:
 *   - pnpm visor:preparar    (clona, instala, levanta compose, migra, siembra y corre demo:prueba)
 *   - pnpm visor:actualizar   (trae origin/main en ../v2-visor, migra, siembra y reinicia si estaba activo)
 *   - pnpm visor:arrancar     (inicia API en 3300 y Web en 3301 en segundo plano)
 *   - pnpm visor:parar        (detiene solo los procesos del visor)
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";

import { REPO_ROOT, registerSecret, resolveCommand } from "./lib.mjs";

export const VISOR_PORTS = {
  postgres: 5442,
  minio: 9010,
  minioConsole: 9011,
  api: 3300,
  web: 3301,
};

export function visorPath(root = REPO_ROOT) {
  return resolve(root, "..", "v2-visor");
}

export function defaultCredentialsPath(visorRoot = visorPath()) {
  return join(visorRoot, ".local", "credenciales-prueba.txt");
}

export function buildDockerComposeEnv() {
  return {
    POSTGRES_PORT: String(VISOR_PORTS.postgres),
    MINIO_PORT: String(VISOR_PORTS.minio),
    MINIO_CONSOLE_PORT: String(VISOR_PORTS.minioConsole),
  };
}

export function generateJwtSecrets() {
  const accessSecret = randomBytes(32).toString("hex");
  const refreshSecret = randomBytes(32).toString("hex");
  registerSecret(accessSecret);
  registerSecret(refreshSecret);
  return { accessSecret, refreshSecret };
}

export function buildApiEnv(secrets = generateJwtSecrets()) {
  const dbUrl = `postgresql://yacco:yacco@localhost:${VISOR_PORTS.postgres}/yacco_dev`;
  registerSecret(dbUrl);
  return {
    PORT: String(VISOR_PORTS.api),
    WEB_ORIGIN: `http://localhost:${VISOR_PORTS.web}`,
    DATABASE_URL: dbUrl,
    DIRECT_URL: dbUrl,
    JWT_ACCESS_SECRET: secrets.accessSecret,
    JWT_ACCESS_EXPIRES_IN: "15m",
    JWT_REFRESH_SECRET: secrets.refreshSecret,
    JWT_REFRESH_EXPIRES_IN: "30d",
    S3_ENDPOINT: `http://localhost:${VISOR_PORTS.minio}`,
    S3_REGION: "auto",
    S3_BUCKET: "yacco-evidence",
    S3_ACCESS_KEY_ID: "yacco",
    S3_SECRET_ACCESS_KEY: "yacco12345",
    S3_FORCE_PATH_STYLE: "true",
    PLANT_LATITUDE: "-12.046374",
    PLANT_LONGITUDE: "-77.042793",
  };
}

export function buildWebEnv() {
  return {
    PORT: String(VISOR_PORTS.web),
    LOCAL_API_ORIGIN: `http://localhost:${VISOR_PORTS.api}`,
  };
}

export function formatSummary(
  url = `http://localhost:${VISOR_PORTS.web}`,
  credentialsPath = defaultCredentialsPath(),
) {
  return [`Dirección del visor: ${url}`, `Contraseñas de prueba: ${credentialsPath}`].join("\n");
}

export function parsePid(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const pid = Number.parseInt(trimmed, 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

export function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

export function stopProcess(pid) {
  if (!isPidAlive(pid)) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/F", "/T", "/PID", String(pid)], { stdio: "ignore" });
  } else {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Ignorar error si el proceso ya terminó
    }
  }
}

export function checkPortAvailable(port, host = "127.0.0.1") {
  return new Promise((resolvePromise) => {
    const server = createServer();
    server.once("error", () => resolvePromise(false));
    server.once("listening", () => {
      server.close(() => resolvePromise(true));
    });
    server.listen(port, host);
  });
}

function runCommandSync(command, args, options = {}) {
  const { cwd = REPO_ROOT, env = process.env, stdio = "inherit" } = options;
  const resolved = resolveCommand(command);
  const result = spawnSync(resolved.file, [...resolved.prefixArgs, ...args], {
    cwd,
    env: { ...process.env, ...resolved.env, ...env },
    stdio,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const msg = result.stderr ? `: ${result.stderr.trim()}` : "";
    throw new Error(`Comando fallido (\`${command} ${args.join(" ")}\`)${msg}`);
  }
  return result;
}

export function getOriginUrl(root = REPO_ROOT) {
  const result = runCommandSync("git", ["remote", "get-url", "origin"], {
    cwd: root,
    stdio: "pipe",
  });
  return result.stdout.trim();
}

async function assertVisorPortsAvailable(ports) {
  for (const [name, port] of Object.entries(ports)) {
    const free = await checkPortAvailable(port);
    if (!free) {
      throw new Error(
        `El puerto del visor ${port} (${name}) ya está ocupado por otro proceso. ` +
          "El visor no puede continuar sin interferir con ese servicio.",
      );
    }
  }
}

function readStoredPid(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    const content = readFileSync(filePath, "utf8");
    return parsePid(content);
  } catch {
    return null;
  }
}

function writeStoredPid(filePath, pid) {
  mkdirSync(resolve(filePath, ".."), { recursive: true });
  writeFileSync(filePath, `${pid}\n`, "utf8");
}

function clearStoredPid(filePath) {
  if (existsSync(filePath)) {
    try {
      unlinkSync(filePath);
    } catch {
      // Ignorar si no se pudo eliminar
    }
  }
}

export async function prepararVisor(options = {}) {
  const { root = REPO_ROOT, out = console, ref = process.env.VISOR_REF ?? "main" } = options;
  const visorRoot = visorPath(root);

  out.log(`Preparando visor en ${visorRoot} (ref: ${ref})...`);

  if (!existsSync(visorRoot)) {
    const originUrl = getOriginUrl(root);
    out.log(`Clonando ${originUrl} (rama: ${ref}) en ${visorRoot}...`);
    runCommandSync("git", ["clone", "--branch", ref, originUrl, visorRoot], { cwd: root });
  } else {
    out.log(`El directorio ${visorRoot} ya existe. Verificando repositorio...`);
  }

  out.log("Instalando dependencias en el visor (pnpm install)...");
  runCommandSync("pnpm", ["install"], { cwd: visorRoot });

  out.log("Levantando contenedores de Docker Compose (yacco-visor)...");
  const composeEnv = buildDockerComposeEnv();
  const composeFile = join(visorRoot, "docker-compose.yml");
  runCommandSync(
    "docker",
    ["compose", "-p", "yacco-visor", "-f", composeFile, "up", "-d", "--wait", "postgres", "minio"],
    { cwd: visorRoot, env: composeEnv },
  );

  const apiEnv = buildApiEnv();

  out.log("Aplicando migraciones en la base de datos del visor...");
  runCommandSync("pnpm", ["--filter", "@yacco/api", "db:deploy"], {
    cwd: visorRoot,
    env: apiEnv,
  });

  out.log("Generando cliente de Prisma...");
  runCommandSync("pnpm", ["--filter", "@yacco/api", "exec", "prisma", "generate"], {
    cwd: visorRoot,
    env: apiEnv,
  });

  out.log("Sembrando catálogo inicial...");
  runCommandSync("pnpm", ["--filter", "@yacco/api", "db:seed"], {
    cwd: visorRoot,
    env: apiEnv,
  });

  out.log("Cargando datos de prueba (pnpm demo:prueba)...");
  runCommandSync("pnpm", ["--filter", "@yacco/api", "demo:prueba"], {
    cwd: visorRoot,
    env: apiEnv,
  });

  out.log("\nVisor preparado con éxito.");
  out.log(formatSummary(`http://localhost:${VISOR_PORTS.web}`, defaultCredentialsPath(visorRoot)));
}

export async function actualizarVisor(options = {}) {
  const { root = REPO_ROOT, out = console, ref = process.env.VISOR_REF ?? "main" } = options;
  const visorRoot = visorPath(root);

  if (!existsSync(visorRoot)) {
    throw new Error(
      `No se encontró el visor en ${visorRoot}. Corré primero «pnpm visor:preparar».`,
    );
  }

  out.log(`Actualizando visor en ${visorRoot} desde origin/${ref}...`);

  const apiPidFile = join(visorRoot, ".visor", "api.pid");
  const webPidFile = join(visorRoot, ".visor", "web.pid");
  const wasApiRunning = isPidAlive(readStoredPid(apiPidFile));
  const wasWebRunning = isPidAlive(readStoredPid(webPidFile));
  const hadRunningProcesses = wasApiRunning || wasWebRunning;

  if (hadRunningProcesses) {
    out.log("Deteniendo procesos del visor antes de actualizar...");
    await pararVisor({ root, out });
  }

  out.log(`Obteniendo últimos cambios de origin/${ref}...`);
  runCommandSync("git", ["fetch", "origin", ref], { cwd: visorRoot });
  runCommandSync("git", ["checkout", ref], { cwd: visorRoot });
  runCommandSync("git", ["reset", "--hard", `origin/${ref}`], { cwd: visorRoot });

  out.log("Instalando dependencias (pnpm install)...");
  runCommandSync("pnpm", ["install"], { cwd: visorRoot });

  const composeEnv = buildDockerComposeEnv();
  const composeFile = join(visorRoot, "docker-compose.yml");
  runCommandSync(
    "docker",
    ["compose", "-p", "yacco-visor", "-f", composeFile, "up", "-d", "--wait", "postgres", "minio"],
    { cwd: visorRoot, env: composeEnv },
  );

  const apiEnv = buildApiEnv();

  out.log("Aplicando migraciones...");
  runCommandSync("pnpm", ["--filter", "@yacco/api", "db:deploy"], {
    cwd: visorRoot,
    env: apiEnv,
  });

  out.log("Generando cliente de Prisma...");
  runCommandSync("pnpm", ["--filter", "@yacco/api", "exec", "prisma", "generate"], {
    cwd: visorRoot,
    env: apiEnv,
  });

  out.log("Sembrando catálogo...");
  runCommandSync("pnpm", ["--filter", "@yacco/api", "db:seed"], {
    cwd: visorRoot,
    env: apiEnv,
  });

  out.log("Cargando datos de prueba...");
  runCommandSync("pnpm", ["--filter", "@yacco/api", "demo:prueba"], {
    cwd: visorRoot,
    env: apiEnv,
  });

  if (hadRunningProcesses) {
    out.log("Reiniciando API y web del visor...");
    await arrancarVisor({ root, out });
  } else {
    out.log("\nVisor actualizado con éxito.");
    out.log(
      formatSummary(`http://localhost:${VISOR_PORTS.web}`, defaultCredentialsPath(visorRoot)),
    );
  }
}

export function startDetachedProcess(options) {
  const { command, args = [], cwd, env = {}, logPath, scriptPath } = options;

  if (process.platform === "win32") {
    // En Windows, los procesos lanzados desde entornos automatizados (como runners de CI o agentes)
    // pertenecen a un Job Object que se destruye al finalizar el subshell del runner.
    // Para desacoplar el proceso y permitir que persista en segundo plano, se invoca a través de WMI.
    const envLines = Object.entries(env)
      .map(([k, v]) => `set "${k}=${v}"`)
      .join("\r\n");
    const formattedArgs = args.map((arg) => (arg.includes(" ") ? `"${arg}"` : arg)).join(" ");
    const scriptBody = [
      "@echo off",
      envLines,
      `"${command}" ${formattedArgs} >> "${logPath}" 2>&1`,
      "",
    ].join("\r\n");

    writeFileSync(scriptPath, scriptBody, "utf8");

    const psCommand = [
      `$res = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{`,
      `  CommandLine = 'cmd.exe /c "${scriptPath.replace(/'/g, "''")}"';`,
      `  CurrentDirectory = '${cwd.replace(/'/g, "''")}'`,
      `};`,
      `$res.ProcessId`,
    ].join(" ");

    const result = spawnSync("powershell", ["-NoProfile", "-Command", psCommand], {
      encoding: "utf8",
    });

    if (result.status !== 0) {
      throw new Error(`Fallo al iniciar proceso en segundo plano en Windows: ${result.stderr}`);
    }

    const pid = parsePid(result.stdout);
    if (!pid) {
      throw new Error(`No se pudo obtener el PID del proceso en segundo plano: ${result.stdout}`);
    }
    return pid;
  }

  const logFd = openSync(logPath, "a");
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  closeSync(logFd);
  return child.pid;
}

export async function arrancarVisor(options = {}) {
  const { root = REPO_ROOT, out = console } = options;
  const visorRoot = visorPath(root);

  if (!existsSync(visorRoot)) {
    throw new Error(
      `No se encontró el visor en ${visorRoot}. Corré primero «pnpm visor:preparar».`,
    );
  }

  const visorDir = join(visorRoot, ".visor");
  mkdirSync(visorDir, { recursive: true });

  const apiPidFile = join(visorDir, "api.pid");
  const webPidFile = join(visorDir, "web.pid");

  const existingApiPid = readStoredPid(apiPidFile);
  if (isPidAlive(existingApiPid)) {
    throw new Error(`La API del visor ya está corriendo (PID ${existingApiPid}).`);
  }

  const existingWebPid = readStoredPid(webPidFile);
  if (isPidAlive(existingWebPid)) {
    throw new Error(`El web del visor ya está corriendo (PID ${existingWebPid}).`);
  }

  await assertVisorPortsAvailable({
    api: VISOR_PORTS.api,
    web: VISOR_PORTS.web,
  });

  out.log("Compilando API en el visor si hace falta...");
  runCommandSync("pnpm", ["--filter", "@yacco/api", "build"], { cwd: visorRoot });

  const apiEnv = buildApiEnv();
  const webEnv = buildWebEnv();

  const apiLogPath = join(visorDir, "api.log");
  const webLogPath = join(visorDir, "web.log");
  const apiLaunchScript = join(visorDir, "start-api.cmd");
  const webLaunchScript = join(visorDir, "start-web.cmd");

  out.log(`Iniciando API del visor en http://localhost:${VISOR_PORTS.api}...`);
  const apiEntry = join(visorRoot, "apps", "api", "dist", "main.js");
  const apiPid = startDetachedProcess({
    command: process.execPath,
    args: [apiEntry],
    cwd: join(visorRoot, "apps", "api"),
    env: apiEnv,
    logPath: apiLogPath,
    scriptPath: apiLaunchScript,
  });
  writeStoredPid(apiPidFile, apiPid);

  out.log(`Iniciando Web del visor en http://localhost:${VISOR_PORTS.web}...`);
  const nuxtBinCandidates = [
    join(visorRoot, "apps", "web-nuxt", "node_modules", "nuxt", "bin", "nuxt.mjs"),
    join(visorRoot, "node_modules", "nuxt", "bin", "nuxt.mjs"),
  ];
  const nuxtBin = nuxtBinCandidates.find(existsSync);
  if (!nuxtBin) {
    throw new Error(
      "No se encontró el binario de Nuxt en apps/web-nuxt/node_modules/nuxt/bin/nuxt.mjs.",
    );
  }
  const webPid = startDetachedProcess({
    command: process.execPath,
    args: [nuxtBin, "dev"],
    cwd: join(visorRoot, "apps", "web-nuxt"),
    env: webEnv,
    logPath: webLogPath,
    scriptPath: webLaunchScript,
  });
  writeStoredPid(webPidFile, webPid);

  out.log("Esperando que los servicios del visor comiencen a responder...");
  for (let i = 0; i < 60; i++) {
    await setTimeout(500);
    const apiAlive = isPidAlive(apiPid);
    const webAlive = isPidAlive(webPid);
    if (!apiAlive || !webAlive) {
      throw new Error(
        "Uno de los procesos del visor se detuvo inesperadamente. Revisá .visor/api.log y .visor/web.log.",
      );
    }
    try {
      const apiOk = await fetch(`http://localhost:${VISOR_PORTS.api}/health`)
        .then((r) => r.ok)
        .catch(() => false);
      const webOk = await fetch(`http://localhost:${VISOR_PORTS.web}/`)
        .then((r) => r.ok)
        .catch(() => false);
      if (apiOk && webOk) {
        break;
      }
    } catch {
      // Continuar esperando
    }
  }

  out.log("\nVisor arrancado en segundo plano.");
  out.log(formatSummary(`http://localhost:${VISOR_PORTS.web}`, defaultCredentialsPath(visorRoot)));
}

export async function pararVisor(options = {}) {
  const { root = REPO_ROOT, out = console } = options;
  const visorRoot = visorPath(root);
  const visorDir = join(visorRoot, ".visor");

  const apiPidFile = join(visorDir, "api.pid");
  const webPidFile = join(visorDir, "web.pid");

  const apiPid = readStoredPid(apiPidFile);
  if (apiPid && isPidAlive(apiPid)) {
    out.log(`Deteniendo API del visor (PID ${apiPid})...`);
    stopProcess(apiPid);
  }
  clearStoredPid(apiPidFile);

  const webPid = readStoredPid(webPidFile);
  if (webPid && isPidAlive(webPid)) {
    out.log(`Deteniendo Web del visor (PID ${webPid})...`);
    stopProcess(webPid);
  }
  clearStoredPid(webPidFile);

  for (let i = 0; i < 20; i++) {
    const apiStillAlive = apiPid ? isPidAlive(apiPid) : false;
    const webStillAlive = webPid ? isPidAlive(webPid) : false;
    if (!apiStillAlive && !webStillAlive) break;
    await setTimeout(200);
  }

  for (const scriptName of ["start-api.cmd", "start-web.cmd"]) {
    const scriptPath = join(visorDir, scriptName);
    if (existsSync(scriptPath)) {
      try {
        unlinkSync(scriptPath);
      } catch {
        // Ignorar si no se pudo eliminar
      }
    }
  }

  out.log("\nProcesos del visor detenidos.");
  out.log(formatSummary(`http://localhost:${VISOR_PORTS.web}`, defaultCredentialsPath(visorRoot)));
}

async function main(argv = process.argv.slice(2)) {
  const command = argv[0];
  switch (command) {
    case "preparar":
      await prepararVisor();
      break;
    case "actualizar":
      await actualizarVisor();
      break;
    case "arrancar":
      await arrancarVisor();
      break;
    case "parar":
      await pararVisor();
      break;
    default:
      console.error(
        `Comando desconocido: "${command ?? ""}".\nUso: node scripts/visor.mjs <preparar|actualizar|arrancar|parar>`,
      );
      process.exitCode = 1;
      break;
  }
}

const isEntryPoint =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;

if (isEntryPoint) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
