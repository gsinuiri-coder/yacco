import { Controller, Get, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { configureApp } from "./configure-app.js";

@Controller("probe")
class ProbeController {
  @Get()
  probe(): { ok: true } {
    return { ok: true };
  }
}

/**
 * The headers go through configureApp, the same wiring main.ts and the
 * integration tests use, so this checks what production actually sends —
 * not a copy of it. A throwaway controller keeps it free of any database.
 */
describe("configureApp — response headers", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("does not announce the framework with x-powered-by", async () => {
    const response = await request(app.getHttpServer()).get("/api/v1/probe").expect(200);
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("forbids being framed, with both the legacy header and the CSP directive", async () => {
    const response = await request(app.getHttpServer()).get("/api/v1/probe").expect(200);
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["content-security-policy"]).toBe("frame-ancestors 'none'");
  });

  it("sends the same headers on errors, which never reach a controller", async () => {
    const response = await request(app.getHttpServer()).get("/api/v1/missing").expect(404);
    expect(response.headers["x-powered-by"]).toBeUndefined();
    expect(response.headers["x-frame-options"]).toBe("DENY");
  });
});
