import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module.js";
import { SalesModule } from "../sales/sales.module.js";
import { MaquilaController } from "./maquila.controller.js";
import { MaquilaService } from "./maquila.service.js";

@Module({
  imports: [PrismaModule, SalesModule],
  controllers: [MaquilaController],
  providers: [MaquilaService],
  exports: [MaquilaService],
})
export class MaquilaModule {}
