import { Controller, Get } from "@nestjs/common";
import { ApiResponse, ApiServiceUnavailableResponse, ApiTags } from "@nestjs/swagger";
import { HealthService } from "./health.service.js";

@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  // Render's health check target: must never touch the database, or a cold
  // Neon pooler would fail the liveness probe instead of just being slow.
  @ApiResponse({ status: 200, description: "The process is up." })
  @Get()
  check(): { status: "ok" } {
    return { status: "ok" };
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
