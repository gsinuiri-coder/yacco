import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module.js";
import { AccessoriesController } from "./accessories.controller.js";
import { AccessoriesService } from "./accessories.service.js";
import { CustomerLocationAccessoriesController } from "./customer-location-accessories.controller.js";

@Module({
  imports: [PrismaModule],
  controllers: [AccessoriesController, CustomerLocationAccessoriesController],
  providers: [AccessoriesService],
  exports: [AccessoriesService],
})
export class AccessoriesModule {}
