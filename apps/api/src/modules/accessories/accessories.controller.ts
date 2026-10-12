import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
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
import type { AuthenticatedRequest } from "../auth/types/authenticated-request.js";
import { AccessoriesService } from "./accessories.service.js";
import {
  AccessoryCountResponseDto,
  AccessoryMovementResponseDto,
  AccessoryReconciliationResponseDto,
  AccessorySummaryResponseDto,
  BorrowedAccessoryResponseDto,
  PaginatedAccessoryMovementsDto,
} from "./dto/accessory-response.dto.js";
import { CountAccessoryDto } from "./dto/count-accessory.dto.js";
import { CreateAccessoryEntryDto } from "./dto/create-accessory-entry.dto.js";
import { CreateAccessoryWriteOffDto } from "./dto/create-accessory-write-off.dto.js";
import { ListAccessoryMovementsQueryDto } from "./dto/list-accessory-movements-query.dto.js";
import { VoidAccessoryChargeDto } from "./dto/void-accessory-charge.dto.js";

@ApiTags("accessories")
@ApiBearerAuth()
@ApiForbiddenResponse({ description: "Missing required role" })
@UseGuards(JwtAccessGuard, RolesGuard)
@Controller("accessories")
export class AccessoriesController {
  constructor(private readonly accessoriesService: AccessoriesService) {}

  @ApiOperation({ summary: "Lista accesorios con stock en planta y total prestado" })
  @ApiResponse({ status: 200, type: AccessorySummaryResponseDto, isArray: true })
  @Roles(UserRole.ADMIN, UserRole.SELLER)
  @Get()
  findAll(@Query("active") active?: string): Promise<AccessorySummaryResponseDto[]> {
    const includeInactive = active === "false" || active === "all";
    return this.accessoriesService.findAll(includeInactive);
  }

  @ApiOperation({ summary: "Reporte de accesorios prestados en clientes" })
  @ApiResponse({ status: 200, type: BorrowedAccessoryResponseDto, isArray: true })
  @Roles(UserRole.ADMIN, UserRole.SELLER)
  @Get("borrowed-report")
  getBorrowedReport(): Promise<BorrowedAccessoryResponseDto[]> {
    return this.accessoriesService.getBorrowedReport();
  }

  @ApiOperation({ summary: "Reconciliación de stock y saldos prestados contra el ledger" })
  @ApiResponse({ status: 200, type: AccessoryReconciliationResponseDto })
  @Roles(UserRole.ADMIN)
  @Get("reconciliation")
  reconciliation(): Promise<AccessoryReconciliationResponseDto> {
    return this.accessoriesService.reconciliation();
  }

  @ApiOperation({ summary: "Anula el cobro de un accesorio previamente realizado" })
  @ApiResponse({ status: 201, type: AccessoryMovementResponseDto })
  @ApiBadRequestResponse({ description: "Validation failed or charge cannot be voided" })
  @Roles(UserRole.ADMIN)
  @Post("movements/:id/void")
  voidCharge(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: VoidAccessoryChargeDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<AccessoryMovementResponseDto> {
    return this.accessoriesService.voidCharge(id, dto, request.user.sub);
  }

  @ApiOperation({ summary: "Registra el ingreso de stock nuevo a planta" })
  @ApiResponse({ status: 201, type: AccessoryMovementResponseDto })
  @Roles(UserRole.ADMIN)
  @Post(":id/entries")
  createEntry(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CreateAccessoryEntryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<AccessoryMovementResponseDto> {
    return this.accessoriesService.createEntry(id, dto, request.user.sub);
  }

  @ApiOperation({ summary: "Registra la baja de accesorios dañados en planta" })
  @ApiResponse({ status: 201, type: AccessoryMovementResponseDto })
  @Roles(UserRole.ADMIN)
  @Post(":id/write-offs")
  createWriteOff(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CreateAccessoryWriteOffDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<AccessoryMovementResponseDto> {
    return this.accessoriesService.createWriteOff(id, dto, request.user.sub);
  }

  @ApiOperation({ summary: "Registra el conteo físico de accesorios en planta" })
  @ApiResponse({ status: 201, type: AccessoryCountResponseDto })
  @Roles(UserRole.ADMIN)
  @Post(":id/count")
  count(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CountAccessoryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<AccessoryCountResponseDto> {
    return this.accessoriesService.count(id, dto, request.user.sub);
  }

  @ApiOperation({ summary: "Lista movimientos del accesorio" })
  @ApiResponse({ status: 200, type: PaginatedAccessoryMovementsDto })
  @Roles(UserRole.ADMIN, UserRole.SELLER)
  @Get(":id/movements")
  listMovements(
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: ListAccessoryMovementsQueryDto,
  ): Promise<PaginatedAccessoryMovementsDto> {
    return this.accessoriesService.listMovements(id, query);
  }
}
