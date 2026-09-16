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
  it("returns RENDER_GIT_COMMIT verbatim when Render injects it", async () => {
    const sha = "00cae6e8b887a5c71cd92bc88799a68e92fa1016";
    const { service } = await buildService({ RENDER_GIT_COMMIT: sha });

    expect(service.deployedCommit()).toBe(sha);
  });

  it("returns null when the variable is absent — never a guess read from git", async () => {
    const { service } = await buildService({});

    expect(service.deployedCommit()).toBeNull();
  });

  it("returns null when the variable is present but empty, as a local .env leaves it", async () => {
    const { service } = await buildService({ RENDER_GIT_COMMIT: "" });

    expect(service.deployedCommit()).toBeNull();
  });

  it("returns DEPLOYED_COMMIT, which is the one Cloud Run gets at deploy time", async () => {
    // Cloud Run no inyecta ninguna variable con el commit: se verificó en un
    // deploy real, donde /health contestó `commit: null`. El valor se pasa
    // explícitamente al desplegar, con un nombre que no nombra plataforma.
    const sha = "11bf5b37e0b842e08dcfdc8c4aefc000bfea6e4c";
    const { service } = await buildService({ DEPLOYED_COMMIT: sha });

    expect(service.deployedCommit()).toBe(sha);
  });

  it("prefers DEPLOYED_COMMIT over RENDER_GIT_COMMIT when both are present", async () => {
    // Los dos valores son DISTINTOS a propósito: con el mismo sha de los dos
    // lados el test pasaría aunque la precedencia estuviera al revés. El caso
    // es real mientras Render siga vivo como vuelta atrás, porque Render
    // inyecta el suyo solo y no se puede apagar.
    const cloudRun = "11bf5b37e0b842e08dcfdc8c4aefc000bfea6e4c";
    const render = "00cae6e8b887a5c71cd92bc88799a68e92fa1016";
    const { service } = await buildService({
      DEPLOYED_COMMIT: cloudRun,
      RENDER_GIT_COMMIT: render,
    });

    expect(service.deployedCommit()).toBe(cloudRun);
  });

  it("falls back to RENDER_GIT_COMMIT when DEPLOYED_COMMIT is empty", async () => {
    // Una variable exportada en blanco es tan fácil como no exportarla, y
    // dejar que gane devolvería null teniendo un valor bueno al lado.
    const render = "00cae6e8b887a5c71cd92bc88799a68e92fa1016";
    const { service } = await buildService({ DEPLOYED_COMMIT: "", RENDER_GIT_COMMIT: render });

    expect(service.deployedCommit()).toBe(render);
  });
});
