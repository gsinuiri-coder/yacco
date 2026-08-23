import { Module } from "@nestjs/common";
import { ContainerTypesController } from "./container-types.controller.js";
import { ContainerTypesService } from "./container-types.service.js";

@Module({
  controllers: [ContainerTypesController],
  providers: [ContainerTypesService],
  exports: [ContainerTypesService],
})
export class ContainerTypesModule {}
