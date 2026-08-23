import { Module } from "@nestjs/common";
import { CustomerLocationsController } from "./customer-locations.controller.js";
import { CustomerLocationsService } from "./customer-locations.service.js";

@Module({
  controllers: [CustomerLocationsController],
  providers: [CustomerLocationsService],
})
export class CustomerLocationsModule {}
