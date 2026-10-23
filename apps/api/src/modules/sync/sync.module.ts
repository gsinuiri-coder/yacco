import { Module } from "@nestjs/common";
import { RouteLocationsModule } from "../route-locations/route-locations.module.js";
import { RoutesModule } from "../routes/routes.module.js";
import { SettingsModule } from "../settings/settings.module.js";
import { RouteSnapshotController } from "./route-snapshot.controller.js";
import { RouteSnapshotService } from "./route-snapshot.service.js";
import { SyncController } from "./sync.controller.js";
import { SyncService } from "./sync.service.js";

@Module({
  imports: [RoutesModule, RouteLocationsModule, SettingsModule],
  controllers: [SyncController, RouteSnapshotController],
  providers: [SyncService, RouteSnapshotService],
})
export class SyncModule {}
