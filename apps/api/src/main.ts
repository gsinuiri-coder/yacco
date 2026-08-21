import "reflect-metadata";
import { pathToFileURL } from "node:url";
import { INestApplication, RequestMethod, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module.js";
import { reportBootstrapFailure } from "./config/report-bootstrap-failure.js";

// Kept outside the versioned prefix on purpose: Render's health check and
// manual DB diagnostics are infra concerns, not a domain REST resource, and
// Render's own config (render.yaml) points at the unversioned /health path.
const GLOBAL_PREFIX_EXCLUDE = [
  { path: "health", method: RequestMethod.GET },
  { path: "health/db", method: RequestMethod.GET },
];

export async function bootstrap(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule);

  // Registers SIGTERM/SIGINT handlers that call app.close() (which runs
  // PrismaService.onModuleDestroy -> $disconnect()) so a platform recycling
  // the instance (Render) doesn't leave the pooled connection dangling.
  app.enableShutdownHooks();

  // credentials:true requires an explicit origin (not "*"); WEB_ORIGIN is per
  // environment (local/demo/production point at different frontends).
  app.enableCors({ origin: process.env.WEB_ORIGIN, credentials: true });

  app.setGlobalPrefix("api/v1", { exclude: GLOBAL_PREFIX_EXCLUDE });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Yacco API")
    .setVersion("0.1.0")
    .addBearerAuth()
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("api/docs", app, swaggerDocument);

  const port = process.env.PORT ?? 3000;
  // Render injects PORT and drops the service if it doesn't bind 0.0.0.0.
  await app.listen(port, "0.0.0.0");

  return app;
}

// Only auto-start when this module is the actual process entrypoint (`tsx
// src/main.ts` / `node dist/main.js`) — not when a test imports `bootstrap`
// to exercise it directly against an ephemeral port.
const isEntryPoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  bootstrap().catch(reportBootstrapFailure);
}
