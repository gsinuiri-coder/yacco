import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, it } from "node:test";

import { REPO_ROOT } from "./lib.mjs";
import {
  VISOR_PORTS,
  buildApiEnv,
  buildDockerComposeEnv,
  buildWebEnv,
  checkPortAvailable,
  formatSummary,
  generateJwtSecrets,
  parsePid,
  visorPath,
} from "./visor.mjs";

describe("docker-compose.yml — puertos configurables", () => {
  it("sin variables de entorno, docker compose config expone los mismos puertos por defecto (5432, 9000, 9001)", () => {
    const composeFile = join(REPO_ROOT, "docker-compose.yml");
    const result = spawnSync("docker", ["compose", "-f", composeFile, "config"], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        POSTGRES_PORT: "",
        MINIO_PORT: "",
        MINIO_CONSOLE_PORT: "",
      },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    const yaml = result.stdout;
    // Postgres publicado en 5432
    assert.match(yaml, /target:\s*5432\s+published:\s*["']?5432["']?/);
    // MinIO publicado en 9000 y 9001
    assert.match(yaml, /target:\s*9000\s+published:\s*["']?9000["']?/);
    assert.match(yaml, /target:\s*9001\s+published:\s*["']?9001["']?/);
  });

  it("con variables de entorno, docker compose config expone los puertos del visor (5442, 9010, 9011)", () => {
    const composeFile = join(REPO_ROOT, "docker-compose.yml");
    const env = buildDockerComposeEnv();
    assert.equal(env.POSTGRES_PORT, "5442");
    assert.equal(env.MINIO_PORT, "9010");
    assert.equal(env.MINIO_CONSOLE_PORT, "9011");

    const result = spawnSync("docker", ["compose", "-f", composeFile, "config"], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        ...env,
      },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    const yaml = result.stdout;
    assert.match(yaml, /target:\s*5432\s+published:\s*["']?5442["']?/);
    assert.match(yaml, /target:\s*9000\s+published:\s*["']?9010["']?/);
    assert.match(yaml, /target:\s*9001\s+published:\s*["']?9011["']?/);
  });
});

describe("visor — puertos y aislamiento del relevo", () => {
  it("los puertos del visor son fijos y nunca tocan los puertos del relevo (3200, 3201, 5432, 9000, 9001)", () => {
    assert.equal(VISOR_PORTS.api, 3300);
    assert.equal(VISOR_PORTS.web, 3301);
    assert.equal(VISOR_PORTS.postgres, 5442);
    assert.equal(VISOR_PORTS.minio, 9010);
    assert.equal(VISOR_PORTS.minioConsole, 9011);

    const relayPorts = new Set([3200, 3201, 5432, 9000, 9001]);
    for (const [name, port] of Object.entries(VISOR_PORTS)) {
      assert.ok(!relayPorts.has(port), `El puerto ${name} (${port}) colisiona con el relevo`);
    }
  });

  it("el directorio del visor es hermano de la raíz del repo (../v2-visor)", () => {
    const visorRoot = visorPath();
    assert.ok(visorRoot.endsWith("v2-visor"));
    assert.notEqual(visorRoot, REPO_ROOT);
  });
});

describe("visor — entorno y secretos", () => {
  it("genera secretos JWT aleatorios en cada llamada, distintos y de longitud segura (>= 32 bytes)", () => {
    const first = generateJwtSecrets();
    const second = generateJwtSecrets();
    assert.ok(first.accessSecret.length >= 64);
    assert.ok(first.refreshSecret.length >= 64);
    assert.notEqual(first.accessSecret, first.refreshSecret);
    assert.notEqual(first.accessSecret, second.accessSecret);
    assert.notEqual(first.refreshSecret, second.refreshSecret);
  });

  it("el entorno de la API apunta a los puertos del visor y a su web, nunca a los del relevo", () => {
    const secrets = {
      accessSecret: "test-access-secret-1234567890123456",
      refreshSecret: "test-refresh-secret-1234567890123456",
    };
    const env = buildApiEnv(secrets);

    assert.equal(env.PORT, "3300");
    assert.equal(env.WEB_ORIGIN, "http://localhost:3301");
    assert.equal(env.DATABASE_URL, "postgresql://yacco:yacco@localhost:5442/yacco_dev");
    assert.equal(env.DIRECT_URL, "postgresql://yacco:yacco@localhost:5442/yacco_dev");
    assert.equal(env.S3_ENDPOINT, "http://localhost:9010");
    assert.equal(env.JWT_ACCESS_SECRET, secrets.accessSecret);
    assert.equal(env.JWT_REFRESH_SECRET, secrets.refreshSecret);
    assert.equal(env.JWT_ACCESS_EXPIRES_IN, "15m");
    assert.equal(env.JWT_REFRESH_EXPIRES_IN, "30d");

    // Verificar que ningún valor apunta al relevo
    assert.ok(!env.DATABASE_URL.includes("5432"));
    assert.ok(!env.S3_ENDPOINT.includes("9000"));
    assert.ok(!env.WEB_ORIGIN.includes("3201"));
  });

  it("el entorno del web apunta a la API del visor en 3300 y escucha en 3301", () => {
    const env = buildWebEnv();
    assert.equal(env.PORT, "3301");
    assert.equal(env.LOCAL_API_ORIGIN, "http://localhost:3300");
  });

  it("el resumen impreso incluye la URL del visor y las credenciales, sin filtrar secretos", () => {
    const summary = formatSummary(
      "http://localhost:3301",
      "C:/path/v2-visor/.local/credenciales-prueba.txt",
    );
    assert.match(summary, /http:\/\/localhost:3301/);
    assert.match(summary, /credenciales-prueba\.txt/);
    assert.ok(!summary.includes("secret"));
    assert.ok(!summary.includes("password"));
    assert.ok(!summary.includes("yacco12345"));
  });
});

describe("visor — gestión de procesos y pids", () => {
  it("parsePid extrae un PID numérico válido y rechaza valores inválidos", () => {
    assert.equal(parsePid("1234\n"), 1234);
    assert.equal(parsePid("  5678  "), 5678);
    assert.equal(parsePid("not-a-number"), null);
    assert.equal(parsePid(""), null);
    assert.equal(parsePid("-10"), null);
  });

  it("checkPortAvailable detecta un puerto ocupado y no mata ningún proceso", async () => {
    const { createServer } = await import("node:net");
    const server = createServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;

    try {
      const available = await checkPortAvailable(port);
      assert.equal(available, false);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }

    const availableAfterClose = await checkPortAvailable(port);
    assert.equal(availableAfterClose, true);
  });

  it("arrancarVisor y actualizarVisor rechazan si el visor no fue preparado", async () => {
    const { arrancarVisor, actualizarVisor } = await import("./visor.mjs");
    const fakeRoot = join(REPO_ROOT, ".local", "non-existent-fake-root");
    await assert.rejects(() => arrancarVisor({ root: fakeRoot }), /No se encontró el visor/);
    await assert.rejects(() => actualizarVisor({ root: fakeRoot }), /No se encontró el visor/);
  });

  it("startDetachedProcess inicia un proceso desacoplado y stopProcess lo detiene limpiamente", async () => {
    const { startDetachedProcess, isPidAlive, stopProcess } = await import("./visor.mjs");
    const { tmpdir } = await import("node:os");
    const { unlinkSync, existsSync } = await import("node:fs");
    const { setTimeout } = await import("node:timers/promises");

    const tmpLog = join(tmpdir(), `visor-test-${Date.now()}.log`);
    const tmpScript = join(tmpdir(), `visor-test-${Date.now()}.cmd`);

    const pid = startDetachedProcess({
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 10000)"],
      cwd: tmpdir(),
      env: { TEST_VAR: "1" },
      logPath: tmpLog,
      scriptPath: tmpScript,
    });

    try {
      assert.ok(Number.isInteger(pid) && pid > 0);
      assert.equal(isPidAlive(pid), true);

      stopProcess(pid);
      await setTimeout(300);
      assert.equal(isPidAlive(pid), false);
    } finally {
      stopProcess(pid);
      if (existsSync(tmpLog)) {
        try {
          unlinkSync(tmpLog);
        } catch {
          // Ignorar
        }
      }
      if (existsSync(tmpScript)) {
        try {
          unlinkSync(tmpScript);
        } catch {
          // Ignorar
        }
      }
    }
  });
});
