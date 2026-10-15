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
import { ListSalesQueryDto } from "./dto/list-sales-query.dto.js";
import { PaginatedSalesDto } from "./dto/sale-response.dto.js";
import { SalesService } from "./sales.service.js";

@ApiTags("sales")
@ApiBearerAuth()
@ApiForbiddenResponse({ description: "Authenticated but missing the ADMIN or SELLER role" })
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SELLER)
@Controller("sales")
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @ApiOperation({
    summary: "Lista ventas por día y cliente, con anuladas visibles y total vigente",
  })
  @ApiResponse({ status: 200, type: PaginatedSalesDto })
  @ApiBadRequestResponse({ description: "Invalid date range" })
  @Get()
  findAll(@Query() query: ListSalesQueryDto): Promise<PaginatedSalesDto> {
    return this.salesService.findAll(query);
  }
}
