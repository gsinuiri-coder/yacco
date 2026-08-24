import { Module } from "@nestjs/common";
import { SalesService } from "./sales.service.js";

@Module({
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}
