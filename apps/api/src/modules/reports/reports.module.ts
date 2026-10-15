import { Module } from "@nestjs/common";
import { ReportsController } from "./reports.controller.js";
import { ReportsService } from "./reports.service.js";
import { RoleDashboardService } from "./role-dashboard.service.js";

@Module({
  controllers: [ReportsController],
  providers: [ReportsService, RoleDashboardService],
})
export class ReportsModule {}
