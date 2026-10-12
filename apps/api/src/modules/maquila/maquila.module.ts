import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module.js";
import { MaquilaController } from "./maquila.controller.js";
import { MaquilaService } from "./maquila.service.js";

@Module({
  imports: [PrismaModule],
  controllers: [MaquilaController],
  providers: [MaquilaService],
  exports: [MaquilaService],
})
export class MaquilaModule {}
