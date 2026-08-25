import { Controller, Get } from "@nestjs/common";
import { ApiResponse, ApiServiceUnavailableResponse, ApiTags } from "@nestjs/swagger";
import { HealthService } from "./health.service.js";

export interface HealthResponse {
  status: "ok";
  /** Commit sha of the running build, or null where the host injects none. */
  commit: string | null;
}

@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  // Render's health check target: must never touch the database, or a cold
  // Neon pooler would fail the liveness probe instead of just being slow.
  //
  // `commit` is exposed here, on the public unauthenticated route, on
  // purpose: the sha of a commit in a public repository is not a secret,
  // and the field exists precisely so anyone can compare what is deployed
  // against main without logging in. Do not move it behind auth "to secure
  // it" — there is nothing to secure, and hiding it defeats the reason it
  // is here.
  @ApiResponse({ status: 200, description: "The process is up." })
  @Get()
  check(): HealthResponse {
    return { status: "ok", commit: this.healthService.deployedCommit() };
  }

  // Manual diagnostic only — not wired to any platform health check.
  @ApiResponse({ status: 200, description: "The database connection is reachable." })
  @ApiServiceUnavailableResponse({ description: "The database is unreachable." })
  @Get("db")
  async checkDatabase(): Promise<{ status: "ok" }> {
    await this.healthService.checkDatabase();
    return { status: "ok" };
  }
}
