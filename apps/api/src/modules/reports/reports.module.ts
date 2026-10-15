import { Module } from "@nestjs/common";
import { ContainerMovementsModule } from "../container-movements/container-movements.module.js";
import { ReportsController } from "./reports.controller.js";
import { ReportsService } from "./reports.service.js";
import { RoleDashboardService } from "./role-dashboard.service.js";

@Module({
  imports: [ContainerMovementsModule],
  controllers: [ReportsController],
  providers: [ReportsService, RoleDashboardService],
})
export class ReportsModule {}
