import { Module } from "@nestjs/common";
import { RoutesModule } from "../routes/routes.module.js";
import { RouteSnapshotController } from "./route-snapshot.controller.js";
import { RouteSnapshotService } from "./route-snapshot.service.js";
import { SyncController } from "./sync.controller.js";
import { SyncService } from "./sync.service.js";

@Module({
  imports: [RoutesModule],
  controllers: [SyncController, RouteSnapshotController],
  providers: [SyncService, RouteSnapshotService],
})
export class SyncModule {}
