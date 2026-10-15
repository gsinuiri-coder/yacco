import { Module } from "@nestjs/common";
import { ContainerMovementsModule } from "../container-movements/container-movements.module.js";
import { SalesController } from "./sales.controller.js";
import { SalesService } from "./sales.service.js";

@Module({
  imports: [ContainerMovementsModule],
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}
