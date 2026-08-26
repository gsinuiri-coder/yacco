import { Module } from "@nestjs/common";
import { RouteSettlementController } from "./route-settlement.controller.js";
import { RouteSettlementService } from "./route-settlement.service.js";

@Module({
  controllers: [RouteSettlementController],
  providers: [RouteSettlementService],
})
export class RouteSettlementModule {}
