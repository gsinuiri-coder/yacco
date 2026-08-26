import { Module } from "@nestjs/common";
import { ContainerMovementsModule } from "../container-movements/container-movements.module.js";
import { RoutesController } from "./routes.controller.js";
import { RoutesService } from "./routes.service.js";

@Module({
  imports: [ContainerMovementsModule],
  controllers: [RoutesController],
  providers: [RoutesService],
  exports: [RoutesService],
})
export class RoutesModule {}
