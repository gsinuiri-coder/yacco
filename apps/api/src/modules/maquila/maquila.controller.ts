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
import { FillMaquilaDto } from "./dto/fill-maquila.dto.js";
import { ListMaquilaMovementsQueryDto } from "./dto/list-maquila-movements-query.dto.js";
import {
  MaquilaBalanceResponseDto,
  MaquilaCustomerSummaryResponseDto,
  MaquilaMovementResponseDto,
  MaquilaReconciliationResponseDto,
  PaginatedMaquilaMovementsResponseDto,
} from "./dto/maquila-response.dto.js";
import { ReceiveMaquilaDto } from "./dto/receive-maquila.dto.js";
import { ReturnMaquilaDto } from "./dto/return-maquila.dto.js";
import { VoidMaquilaMovementDto } from "./dto/void-maquila-movement.dto.js";
import { MaquilaService } from "./maquila.service.js";

@ApiTags("maquila")
@ApiBearerAuth()
@ApiForbiddenResponse({ description: "Missing required role" })
@UseGuards(JwtAccessGuard, RolesGuard)
@Controller("maquila")
export class MaquilaController {
  constructor(private readonly maquilaService: MaquilaService) {}

  @ApiOperation({ summary: "Registra recepción de envases vacíos de cliente (maquila)" })
  @ApiResponse({ status: 201, type: MaquilaMovementResponseDto })
  @Roles(UserRole.ADMIN, UserRole.SELLER)
  @Post("receptions")
  receive(
    @Body() dto: ReceiveMaquilaDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<MaquilaMovementResponseDto> {
    return this.maquilaService.receive(dto, req.user.sub);
  }

  @ApiOperation({ summary: "Registra llenado de envases de cliente (maquila)" })
  @ApiResponse({ status: 201, type: MaquilaMovementResponseDto })
  @Roles(UserRole.ADMIN, UserRole.PLANT_SUPERVISOR, UserRole.PLANT_OPERATOR)
  @Post("fillings")
  fill(
    @Body() dto: FillMaquilaDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<MaquilaMovementResponseDto> {
    return this.maquilaService.fill(dto, req.user.sub);
  }

  @ApiOperation({
    summary: "Registra devolución de envases llenos al cliente y genera venta/cobro",
  })
  @ApiResponse({ status: 201, type: MaquilaMovementResponseDto })
  @Roles(UserRole.ADMIN, UserRole.SELLER)
  @Post("returns")
  return(
    @Body() dto: ReturnMaquilaDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<MaquilaMovementResponseDto> {
    return this.maquilaService.return(dto, req.user.sub);
  }

  @ApiOperation({ summary: "Anula un movimiento de maquila" })
  @ApiResponse({ status: 201, type: MaquilaMovementResponseDto })
  @Roles(UserRole.ADMIN, UserRole.PLANT_SUPERVISOR)
  @Post("movements/:id/void")
  voidMovement(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: VoidMaquilaMovementDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<MaquilaMovementResponseDto> {
    return this.maquilaService.voidMovement(id, dto, {
      id: req.user.sub,
      roles: req.user.roles,
    });
  }

  @ApiOperation({ summary: "Lista clientes que tienen bidones de maquila en la planta" })
  @ApiResponse({ status: 200, type: [MaquilaCustomerSummaryResponseDto] })
  @Roles(UserRole.ADMIN, UserRole.SELLER, UserRole.PLANT_SUPERVISOR, UserRole.PLANT_OPERATOR)
  @Get("customers")
  listCustomersWithBalances(): Promise<MaquilaCustomerSummaryResponseDto[]> {
    return this.maquilaService.listCustomersWithBalances();
  }

  @ApiOperation({ summary: "Lista saldos de maquila por cliente y tipo de envase" })
  @ApiResponse({ status: 200, type: [MaquilaBalanceResponseDto] })
  @Roles(UserRole.ADMIN, UserRole.SELLER, UserRole.PLANT_SUPERVISOR, UserRole.PLANT_OPERATOR)
  @Get("balances")
  listBalances(@Query("customerId") customerId?: string): Promise<MaquilaBalanceResponseDto[]> {
    return this.maquilaService.listBalances(customerId);
  }

  @ApiOperation({ summary: "Lista saldos de maquila de un cliente específico" })
  @ApiResponse({ status: 200, type: [MaquilaBalanceResponseDto] })
  @Roles(UserRole.ADMIN, UserRole.SELLER, UserRole.PLANT_SUPERVISOR, UserRole.PLANT_OPERATOR)
  @Get("customers/:customerId/balances")
  getCustomerBalances(
    @Param("customerId", ParseUUIDPipe) customerId: string,
  ): Promise<MaquilaBalanceResponseDto[]> {
    return this.maquilaService.listBalances(customerId);
  }

  @ApiOperation({ summary: "Lista movimientos de maquila paginados" })
  @ApiResponse({ status: 200, type: PaginatedMaquilaMovementsResponseDto })
  @Roles(UserRole.ADMIN, UserRole.SELLER, UserRole.PLANT_SUPERVISOR, UserRole.PLANT_OPERATOR)
  @Get("movements")
  listMovements(
    @Query() query: ListMaquilaMovementsQueryDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<PaginatedMaquilaMovementsResponseDto> {
    return this.maquilaService.listMovements(query, {
      id: req.user.sub,
      roles: req.user.roles,
    });
  }

  @ApiOperation({ summary: "Cuadre / reconciliación de saldos de maquila contra libro" })
  @ApiResponse({ status: 200, type: MaquilaReconciliationResponseDto })
  @Roles(UserRole.ADMIN)
  @Get("reconciliation")
  reconcile(): Promise<MaquilaReconciliationResponseDto> {
    return this.maquilaService.reconcile();
  }
}
