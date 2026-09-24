import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../prisma/prisma.service.js";
import type { AppEnvironment } from "../../config/env.validation.js";
import { APP_ENVIRONMENTS } from "../../config/env.validation.js";

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
   * DEPLOYED_COMMIT, which the Cloud Run deploy sets explicitly. Cloud Run
   * injects nothing equivalent — verified in a real deploy, where /health
   * answered `commit: null` — so the value is passed in at deploy time. The
   * RENDER_GIT_COMMIT fallback (D-009) left with Render, in phase 7.
   *
   * Deliberately NO fallback that reads git from the process: a container has
   * no repository, and a plausible-but-false value is worse than null — the
   * whole point of this field is to be trusted when it differs from main's
   * tip. Never trimmed, normalized or shortened either: it is compared as-is
   * against `git rev-parse`.
   */
  deployedCommit(): string | null {
    const commit = this.configService.get<string>("DEPLOYED_COMMIT");
    return commit === undefined || commit === "" ? null : commit;
  }

  /**
   * Which of production | demo | local answered this request — the witness
   * GET /health exposes so a browser hitting the app through Vercel's
   * rewrite can tell which Cloud Run service it actually reached (see P-05
   * in docs/ARQUITECTURA.md). Both services run the same image and would
   * otherwise return an identical body.
   *
   * Defaults to null, NEVER to "production", when APP_ENV is absent. The
   * unversioned route and the same-image services mean nothing else can
   * distinguish them, so a forgotten variable on the production service must
   * fail the verification loudly (the caller sees null and knows something
   * is wrong) instead of lying — the same reasoning as the Swagger gate in
   * main.ts. env.validation.ts rejects any value outside the three, so by
   * the time it reaches here the raw value is either unset or trustworthy;
   * the equality checks below are what let a unit test hand this service a
   * hand-built ConfigService that skips that validation.
   */
  appEnvironment(): AppEnvironment | null {
    const raw = this.configService.get<string>("APP_ENV");
    return (APP_ENVIRONMENTS as readonly string[]).includes(raw ?? "")
      ? (raw as AppEnvironment)
      : null;
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
