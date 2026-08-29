import { Module } from "@nestjs/common";
import { ContainerMovementsModule } from "../container-movements/container-movements.module.js";
import { RouteSettlementController } from "./route-settlement.controller.js";
import { RouteSettlementService } from "./route-settlement.service.js";

// Liquidar emite los EMPTY_UNLOAD que devuelven los vacíos al galpón, y el
// ledger se escribe SIEMPRE por su servicio, nunca con un insert propio.
@Module({
  imports: [ContainerMovementsModule],
  controllers: [RouteSettlementController],
  providers: [RouteSettlementService],
})
export class RouteSettlementModule {}
