import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module.js";
import { ContainerMovementsModule } from "../container-movements/container-movements.module.js";
import { VehiclesModule } from "../vehicles/vehicles.module.js";
import { RoutePitStopsController } from "./route-pit-stops.controller.js";
import { RoutePitStopsService } from "./route-pit-stops.service.js";

@Module({
  imports: [PrismaModule, ContainerMovementsModule, VehiclesModule],
  controllers: [RoutePitStopsController],
  providers: [RoutePitStopsService],
  exports: [RoutePitStopsService],
})
export class RoutePitStopsModule {}
