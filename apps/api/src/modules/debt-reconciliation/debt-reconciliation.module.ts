import { Module } from "@nestjs/common";
import { DebtReconciliationController } from "./debt-reconciliation.controller.js";
import { DebtReconciliationService } from "./debt-reconciliation.service.js";

@Module({
  controllers: [DebtReconciliationController],
  providers: [DebtReconciliationService],
})
export class DebtReconciliationModule {}
