// Standalone (no Nest/AppModule dependency) so it can be unit-tested without
// pulling in ConfigModule.forRoot()'s eager env validation — see main.ts.

// Fail loudly at boot (bad/missing env, DB unreachable, etc.) instead of
// surfacing as an opaque failure on the first request or Prisma query.
export function reportBootstrapFailure(error: unknown): void {
  console.error("Failed to start the application:", error);
  process.exitCode = 1;
}
