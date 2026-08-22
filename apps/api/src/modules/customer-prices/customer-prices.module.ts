import { Module } from "@nestjs/common";
import { CustomerPricesController } from "./customer-prices.controller.js";
import { CustomerPricesService } from "./customer-prices.service.js";

@Module({
  controllers: [CustomerPricesController],
  providers: [CustomerPricesService],
})
export class CustomerPricesModule {}
