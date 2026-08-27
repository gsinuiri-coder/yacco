import "reflect-metadata";
import { pathToFileURL } from "node:url";
import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module.js";
import { configureApp } from "./config/configure-app.js";
import { parseWebOrigins } from "./config/env.validation.js";
import { reportBootstrapFailure } from "./config/report-bootstrap-failure.js";

export async function bootstrap(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule);

  // Registers SIGTERM/SIGINT handlers that call app.close() (which runs
  // PrismaService.onModuleDestroy -> $disconnect()) so a platform recycling
  // the instance (Render) doesn't leave the pooled connection dangling.
  app.enableShutdownHooks();

  // credentials:true requires explicit origins (not "*"); WEB_ORIGIN is a
  // comma-separated list so local dev and a deployed frontend can both be
  // allowed at once. ConfigModule's validate (env.validation.ts) already
  // fails the boot if it parses to an empty list, so this is never [].
  app.enableCors({ origin: parseWebOrigins(process.env.WEB_ORIGIN), credentials: true });

  configureApp(app);

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
