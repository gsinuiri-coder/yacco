import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module.js";
import {
  RouteLocationPointsController,
  RouteLocationsController,
} from "./route-locations.controller.js";
import { RouteLocationsService } from "./route-locations.service.js";

@Module({
  imports: [PrismaModule],
  controllers: [RouteLocationPointsController, RouteLocationsController],
  providers: [RouteLocationsService],
  exports: [RouteLocationsService],
})
export class RouteLocationsModule {}
