import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module.js";
import { VehicleReviewTypesController } from "./vehicle-review-types.controller.js";
import { VehiclesController } from "./vehicles.controller.js";
import { VehiclesService } from "./vehicles.service.js";

@Module({
  imports: [PrismaModule],
  controllers: [VehiclesController, VehicleReviewTypesController],
  providers: [VehiclesService],
  exports: [VehiclesService],
})
export class VehiclesModule {}
