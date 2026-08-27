import { INestApplication, RequestMethod, ValidationPipe } from "@nestjs/common";
import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter.js";

// Kept outside the versioned prefix on purpose: Render's health check and
// manual DB diagnostics are infra concerns, not a domain REST resource, and
// Render's own config (render.yaml) points at the unversioned /health path.
const GLOBAL_PREFIX_EXCLUDE = [
  { path: "health", method: RequestMethod.GET },
  { path: "health/db", method: RequestMethod.GET },
];

/**
 * The app wiring shared by the real process (main.ts) and every integration
 * test (test-app.ts): global prefix, validation pipe, and the exceptions
 * filter. Kept out of main.ts so a test booting the app through
 * Test.createTestingModule() exercises the exact same request pipeline as
 * production, instead of a hand-kept copy that can drift.
 *
 * Deliberately excludes enableCors, enableShutdownHooks, Swagger and
 * app.listen: those are process concerns (enableCors also needs WEB_ORIGIN),
 * not request-handling ones, and integration tests never need them.
 */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix("api/v1", { exclude: GLOBAL_PREFIX_EXCLUDE });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
}
