import { Module } from "@nestjs/common";
import { ContainerCountsModule } from "../container-counts/container-counts.module.js";
import { ContainerMovementsModule } from "../container-movements/container-movements.module.js";
import { SalesModule } from "../sales/sales.module.js";
import { RosterLoaderService } from "./roster-loader.service.js";

/**
 * No controller — same as SalesModule: this is orchestration for the CLI
 * entrypoint (`src/cli/load-roster.ts`) only, never a public HTTP route.
 * Registered in AppModule so that entrypoint can boot the real app context
 * (`NestFactory.createApplicationContext(AppModule)`) and resolve the real,
 * already-wired services — never a second, parallel implementation of the
 * container/sales domain logic.
 */
@Module({
  imports: [ContainerMovementsModule, ContainerCountsModule, SalesModule],
  providers: [RosterLoaderService],
  exports: [RosterLoaderService],
})
export class RosterLoaderModule {}
