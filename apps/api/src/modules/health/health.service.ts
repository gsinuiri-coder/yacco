import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../prisma/prisma.service.js";

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * The git commit the running build was made from, as Render injects it
   * through RENDER_GIT_COMMIT — or null when the variable is absent or
   * empty (local development, tests, any other host).
   *
   * Deliberately NO fallback that reads git from the process: Render's
   * container has no repository, and a plausible-but-false value is worse
   * than null — the whole point of this field is to be trusted when it
   * differs from main's tip. Never trimmed, normalized or shortened either:
   * it is compared as-is against `git rev-parse`.
   */
  deployedCommit(): string | null {
    const commit = this.configService.get<string>("RENDER_GIT_COMMIT");
    return commit === undefined || commit === "" ? null : commit;
  }

  async checkDatabase(): Promise<void> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      throw new ServiceUnavailableException("Database is unreachable", {
        cause: error instanceof Error ? error : undefined,
      });
    }
  }
}
