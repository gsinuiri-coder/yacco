import { ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { jest } from "@jest/globals";
import { PrismaService } from "../../prisma/prisma.service.js";
import { HealthService } from "./health.service.js";

function buildPrismaMock() {
  return {
    $queryRaw: jest.fn<() => Promise<unknown>>(),
  };
}

async function buildService(env: Record<string, string | undefined> = {}) {
  const prisma = buildPrismaMock();
  const moduleRef = await Test.createTestingModule({
    providers: [
      HealthService,
      { provide: PrismaService, useValue: prisma },
      { provide: ConfigService, useValue: { get: (key: string) => env[key] } },
    ],
  }).compile();
  return { service: moduleRef.get(HealthService), prisma };
}

describe("HealthService.checkDatabase", () => {
  it("resolves when the database answers the query", async () => {
    const { service, prisma } = await buildService();
    prisma.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);

    await expect(service.checkDatabase()).resolves.toBeUndefined();
  });

  it("throws ServiceUnavailableException when the database is unreachable", async () => {
    const { service, prisma } = await buildService();
    prisma.$queryRaw.mockRejectedValue(new Error("connection refused"));

    await expect(service.checkDatabase()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe("HealthService.deployedCommit", () => {
  it("returns DEPLOYED_COMMIT, which is the one Cloud Run gets at deploy time", async () => {
    // Cloud Run no inyecta ninguna variable con el commit: se verificó en un
    // deploy real, donde /health contestó `commit: null`. El valor se pasa
    // explícitamente al desplegar, con un nombre que no nombra plataforma.
    const sha = "11bf5b37e0b842e08dcfdc8c4aefc000bfea6e4c";
    const { service } = await buildService({ DEPLOYED_COMMIT: sha });

    expect(service.deployedCommit()).toBe(sha);
  });

  it("returns null when the variable is absent — never a guess read from git", async () => {
    const { service } = await buildService({});

    expect(service.deployedCommit()).toBeNull();
  });

  it("returns null when the variable is present but empty, as a local .env leaves it", async () => {
    const { service } = await buildService({ DEPLOYED_COMMIT: "" });

    expect(service.deployedCommit()).toBeNull();
  });

  it("ignores RENDER_GIT_COMMIT: Render is retired and nothing deploys through it", async () => {
    // RENDER_GIT_COMMIT con valor y DEPLOYED_COMMIT ausente o vacía: son los
    // dos casos en que la reserva de Render (D-009) contestaba. Con
    // DEPLOYED_COMMIT presente la reserva nunca se leía y el test pasaría
    // aunque siguiera en el código.
    const render = "00cae6e8b887a5c71cd92bc88799a68e92fa1016";
    const absent = await buildService({ RENDER_GIT_COMMIT: render });
    const empty = await buildService({ DEPLOYED_COMMIT: "", RENDER_GIT_COMMIT: render });

    expect(absent.service.deployedCommit()).toBeNull();
    expect(empty.service.deployedCommit()).toBeNull();
  });
});

describe("HealthService.appEnvironment", () => {
  it("returns null when APP_ENV is absent — the safe default, never a guess of production", async () => {
    // Es el caso que importa: si sólo se prueba con APP_ENV seteada, no se
    // distingue "usa el default seguro" de "no tiene default".
    const { service } = await buildService({});

    expect(service.appEnvironment()).toBeNull();
  });

  it("returns null when APP_ENV is present but empty, as a local .env leaves it", async () => {
    const { service } = await buildService({ APP_ENV: "" });

    expect(service.appEnvironment()).toBeNull();
  });

  it("returns 'production' when APP_ENV is production", async () => {
    const { service } = await buildService({ APP_ENV: "production" });

    expect(service.appEnvironment()).toBe("production");
  });

  it("returns 'demo' when APP_ENV is demo", async () => {
    const { service } = await buildService({ APP_ENV: "demo" });

    expect(service.appEnvironment()).toBe("demo");
  });

  it("returns 'local' when APP_ENV is local", async () => {
    const { service } = await buildService({ APP_ENV: "local" });

    expect(service.appEnvironment()).toBe("local");
  });

  it("returns null for a value outside the three, rather than passing it through", async () => {
    // env.validation.ts rejects this at boot in the real process (IsIn); this
    // covers the service in isolation, the way this file's ConfigService mock
    // skips that validation for every other case above.
    const { service } = await buildService({ APP_ENV: "staging" });

    expect(service.appEnvironment()).toBeNull();
  });
});
