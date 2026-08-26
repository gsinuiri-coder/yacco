import { Module } from "@nestjs/common";
import { ContainerMovementsModule } from "../container-movements/container-movements.module.js";
import { SalesService } from "./sales.service.js";

@Module({
  imports: [ContainerMovementsModule],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}
