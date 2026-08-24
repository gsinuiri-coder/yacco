import { Module } from "@nestjs/common";
import { ContainerMovementsModule } from "../container-movements/container-movements.module.js";
import { ContainerCountsController } from "./container-counts.controller.js";
import { ContainerCountsService } from "./container-counts.service.js";

@Module({
  imports: [ContainerMovementsModule],
  controllers: [ContainerCountsController],
  providers: [ContainerCountsService],
  exports: [ContainerCountsService],
})
export class ContainerCountsModule {}
