import { Module } from "@nestjs/common";
import { RoutesModule } from "../routes/routes.module.js";
import { SyncController } from "./sync.controller.js";
import { SyncService } from "./sync.service.js";

@Module({
  imports: [RoutesModule],
  controllers: [SyncController],
  providers: [SyncService],
})
export class SyncModule {}
