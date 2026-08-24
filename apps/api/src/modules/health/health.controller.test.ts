import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { PrismaService } from "../../prisma/prisma.service.js";
import { HealthController } from "./health.controller.js";
import { HealthService } from "./health.service.js";

/**
 * HTTP-level, without a database: proves GET /health answers 200 with
 * `commit: null` when the host injects nothing — the route must never fail
 * for lack of the variable. The integration test covers the other half
 * (the variable set before boot, the value echoed) through the real
 * AppModule.
 */
async function bootApp(env: Record<string, string | undefined>): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [
      HealthService,
      { provide: PrismaService, useValue: {} },
      { provide: ConfigService, useValue: { get: (key: string) => env[key] } },
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

describe("GET /health", () => {
  let app: INestApplication;

  afterEach(async () => {
    await app.close();
  });

  it("answers 200 with commit null when RENDER_GIT_COMMIT is not set", async () => {
    app = await bootApp({});

    const response = await request(app.getHttpServer()).get("/health").expect(200);
    expect(response.body).toEqual({ status: "ok", commit: null });
  });

  it("answers 200 with the injected commit when RENDER_GIT_COMMIT is set", async () => {
    app = await bootApp({ RENDER_GIT_COMMIT: "89deab1aaeda3eb6de53ecdce57e820ff054abf6" });

    const response = await request(app.getHttpServer()).get("/health").expect(200);
    expect(response.body).toEqual({
      status: "ok",
      commit: "89deab1aaeda3eb6de53ecdce57e820ff054abf6",
    });
  });
});
