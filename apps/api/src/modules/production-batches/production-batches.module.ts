import { Module } from "@nestjs/common";
import { ContainerMovementsModule } from "../container-movements/container-movements.module.js";
import { ProductionBatchesController } from "./production-batches.controller.js";
import { ProductionBatchesService } from "./production-batches.service.js";

@Module({
  imports: [ContainerMovementsModule],
  controllers: [ProductionBatchesController],
  providers: [ProductionBatchesService],
  exports: [ProductionBatchesService],
})
export class ProductionBatchesModule {}
