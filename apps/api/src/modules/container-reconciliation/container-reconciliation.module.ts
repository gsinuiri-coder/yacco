import { Module } from "@nestjs/common";
import { ContainerReconciliationController } from "./container-reconciliation.controller.js";
import { ContainerReconciliationService } from "./container-reconciliation.service.js";

@Module({
  controllers: [ContainerReconciliationController],
  providers: [ContainerReconciliationService],
})
export class ContainerReconciliationModule {}
