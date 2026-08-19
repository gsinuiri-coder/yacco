import "reflect-metadata";
import { pathToFileURL } from "node:url";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module.js";
import { reportBootstrapFailure } from "./config/report-bootstrap-failure.js";

export async function bootstrap(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule);

  // Registers SIGTERM/SIGINT handlers that call app.close() (which runs
  // PrismaService.onModuleDestroy -> $disconnect()) so a platform recycling
  // the instance (Render) doesn't leave the pooled connection dangling.
  app.enableShutdownHooks();

  app.setGlobalPrefix("api/v1");
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
  await app.listen(port);

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
