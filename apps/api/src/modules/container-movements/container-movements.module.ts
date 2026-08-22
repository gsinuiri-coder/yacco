import { Module } from "@nestjs/common";
import { ContainerMovementsController } from "./container-movements.controller.js";
import { ContainerMovementsService } from "./container-movements.service.js";

@Module({
  controllers: [ContainerMovementsController],
  providers: [ContainerMovementsService],
  exports: [ContainerMovementsService],
})
export class ContainerMovementsModule {}
