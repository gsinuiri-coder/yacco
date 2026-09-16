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
   * The git commit the running build was made from, or null when no host
   * injects one (local development, tests).
   *
   * Two variables, in this order, because two hosts serve this app at once
   * during the migration: DEPLOYED_COMMIT, which the Cloud Run deploy sets
   * explicitly, and RENDER_GIT_COMMIT, which Render injects on its own.
   * Cloud Run injects NOTHING equivalent — it was verified in a real deploy,
   * where /health answered `commit: null` — so the value has to be passed in
   * at deploy time, and a platform-neutral name is what lets the same code
   * serve both while Render stays alive as the way back.
   *
   * Deliberately NO fallback that reads git from the process: a container has
   * no repository, and a plausible-but-false value is worse than null — the
   * whole point of this field is to be trusted when it differs from main's
   * tip. Never trimmed, normalized or shortened either: it is compared as-is
   * against `git rev-parse`.
   */
  deployedCommit(): string | null {
    const candidates = [
      this.configService.get<string>("DEPLOYED_COMMIT"),
      this.configService.get<string>("RENDER_GIT_COMMIT"),
    ];
    const commit = candidates.find((value) => value !== undefined && value !== "");
    return commit ?? null;
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
