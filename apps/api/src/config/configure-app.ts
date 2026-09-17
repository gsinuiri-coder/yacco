import { INestApplication, RequestMethod, ValidationPipe } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter.js";

// Kept outside the versioned prefix on purpose: Render's health check and
// manual DB diagnostics are infra concerns, not a domain REST resource, and
// Render's own config (render.yaml) points at the unversioned /health path.
const GLOBAL_PREFIX_EXCLUDE = [
  { path: "health", method: RequestMethod.GET },
  { path: "health/db", method: RequestMethod.GET },
];

/**
 * The cheap half of finding A6 (phase 6 security audit), without a new
 * dependency: stop announcing Express, and refuse to be framed (clickjacking)
 * with both X-Frame-Options, for old browsers, and CSP frame-ancestors.
 *
 * Deliberately NOT a full Content-Security-Policy: a policy that restricts
 * scripts or connections has to be tested against the web first, and is in
 * the backlog. `frame-ancestors` alone restricts nothing but framing.
 *
 * A plain middleware registered before anything else, so it also covers the
 * 404s and errors that never reach a controller.
 */
function applySecurityHeaders(app: INestApplication): void {
  const httpServer = app.getHttpAdapter().getInstance() as { disable?: (setting: string) => void };
  httpServer.disable?.("x-powered-by");
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
    next();
  });
}

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
  applySecurityHeaders(app);
  app.setGlobalPrefix("api/v1", { exclude: GLOBAL_PREFIX_EXCLUDE });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
}
