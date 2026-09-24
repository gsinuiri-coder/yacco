import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import { JwtAccessGuard } from "../auth/guards/jwt-access.guard.js";
import { ProductionReportQueryDto } from "./dto/production-report-query.dto.js";
import {
  CustomerDebtsReportDto,
  LoanedContainersReportDto,
  ProductionReportDto,
} from "./dto/report-response.dto.js";
import { ReportsService } from "./reports.service.js";

/** Reportes post-MVP (HU-19, HU-20, HU-21): la spec los pide para el administrador. */
@ApiTags("reports")
@ApiBearerAuth()
@ApiForbiddenResponse({ description: "Authenticated but missing the ADMIN role" })
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller("reports")
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @ApiOperation({
    summary: "Deuda por cliente, con el total y la fecha del cargo más antiguo (HU-19)",
  })
  @ApiResponse({ status: 200, type: CustomerDebtsReportDto })
  @Get("debt")
  customerDebts(): Promise<CustomerDebtsReportDto> {
    return this.reportsService.customerDebts();
  }

  @ApiOperation({ summary: "Envases prestados por cliente y tipo, con el total (HU-20)" })
  @ApiResponse({ status: 200, type: LoanedContainersReportDto })
  @Get("loaned-containers")
  loanedContainers(): Promise<LoanedContainersReportDto> {
    return this.reportsService.loanedContainers();
  }

  @ApiOperation({ summary: "Producción por período, por tipo de envase y por lote (HU-21)" })
  @ApiResponse({ status: 200, type: ProductionReportDto })
  @ApiBadRequestResponse({ description: "Falta el período, o está al revés" })
  @Get("production")
  production(@Query() query: ProductionReportQueryDto): Promise<ProductionReportDto> {
    return this.reportsService.production(query);
  }
}
