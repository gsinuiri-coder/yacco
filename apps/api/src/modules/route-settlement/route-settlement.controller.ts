import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import { JwtAccessGuard } from "../auth/guards/jwt-access.guard.js";
import type { AuthenticatedRequest } from "../auth/types/authenticated-request.js";
import { CreateRouteSettlementDto } from "./dto/create-route-settlement.dto.js";
import {
  CreateRouteSettlementResponseDto,
  GetRouteSettlementResponseDto,
} from "./dto/route-settlement-response.dto.js";
import { RouteSettlementService } from "./route-settlement.service.js";

/**
 * Nested under the route, same pattern as CustomerPricesController. Reading
 * the conciliation screen is office work (ADMIN, SELLER); actually closing
 * the route is an ADMIN decision only — it flips RouteStatus and can never
 * be undone (out of scope: reopening a settlement).
 */
@ApiTags("route-settlement")
@ApiBearerAuth()
@UseGuards(JwtAccessGuard, RolesGuard)
@Controller("routes/:routeId")
export class RouteSettlementController {
  constructor(private readonly routeSettlementService: RouteSettlementService) {}

  @ApiOperation({
    summary:
      "Conciliación de la ruta: lo esperado según el libro y, si ya se liquidó, lo persistido",
    description:
      "Sirve ANTES de liquidar: es la pantalla contra la que se cuentan envases en la puerta",
  })
  @ApiResponse({ status: 200, type: GetRouteSettlementResponseDto })
  @ApiNotFoundResponse({ description: "Route id does not exist" })
  @ApiForbiddenResponse({ description: "Authenticated but missing the ADMIN or SELLER role" })
  @Roles(UserRole.ADMIN, UserRole.SELLER)
  @Get("settlement")
  getSettlement(
    @Param("routeId", ParseUUIDPipe) routeId: string,
  ): Promise<GetRouteSettlementResponseDto> {
    return this.routeSettlementService.getSettlementView(routeId);
  }

  @ApiOperation({
    summary: "Liquida la ruta: FINISHED -> SETTLED, conciliando envases y dinero (solo ADMIN)",
    description:
      "Nunca bloquea por una diferencia de envases ni por un pago PENDING: ambos quedan registrados",
  })
  @ApiResponse({ status: 201, type: CreateRouteSettlementResponseDto })
  @ApiBadRequestResponse({ description: "Validation failed" })
  @ApiNotFoundResponse({ description: "Route id does not exist" })
  @ApiConflictResponse({ description: "Route is not FINISHED, or was already settled" })
  @ApiForbiddenResponse({ description: "Authenticated but missing the ADMIN role" })
  @Roles(UserRole.ADMIN)
  @Post("settlement")
  settle(
    @Param("routeId", ParseUUIDPipe) routeId: string,
    @Body() dto: CreateRouteSettlementDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<CreateRouteSettlementResponseDto> {
    // settledById comes from the access token, never from the body.
    return this.routeSettlementService.settle(routeId, dto, request.user.sub);
  }
}
