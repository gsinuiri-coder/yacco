import { Module } from "@nestjs/common";
import { IssuerSettingsController } from "./issuer-settings.controller.js";
import { IssuerSettingsService } from "./issuer-settings.service.js";
import { ReceiptsController } from "./receipts.controller.js";
import { ReceiptsService } from "./receipts.service.js";

@Module({
  controllers: [IssuerSettingsController, ReceiptsController],
  providers: [IssuerSettingsService, ReceiptsService],
  exports: [ReceiptsService],
})
export class ReceiptsModule {}
