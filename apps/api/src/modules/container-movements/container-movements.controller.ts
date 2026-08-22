import { Body, Controller, Get, Post, Query, Req, UseGuards } from "@nestjs/common";
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
import { ContainerMovementsService } from "./container-movements.service.js";
import { CreateContainerMovementDto } from "./dto/create-container-movement.dto.js";
import {
  ContainerInventoryItemDto,
  ContainerMovementResponseDto,
  PaginatedContainerMovementsDto,
} from "./dto/container-movement-response.dto.js";
import { ListContainerMovementsQueryDto } from "./dto/list-container-movements-query.dto.js";

/**
 * ADMIN and SELLER register movements (office capture, this phase); DRIVER
 * field writes arrive later through the sync endpoint, not here. There is
 * deliberately no PATCH/DELETE route: the ledger is append-only, a mistake
 * is corrected with an inverse movement.
 */
@ApiTags("container-movements")
@ApiBearerAuth()
@ApiForbiddenResponse({ description: "Authenticated but missing the ADMIN or SELLER role" })
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SELLER)
@Controller("container-movements")
export class ContainerMovementsController {
  constructor(private readonly containerMovementsService: ContainerMovementsService) {}

  @ApiOperation({ summary: "Registra un movimiento en el libro de envases" })
  @ApiResponse({ status: 201, type: ContainerMovementResponseDto })
  @ApiBadRequestResponse({
    description:
      "Validation failed, the state pair is not valid for this type, or a reference does not exist",
  })
  @Post()
  create(
    @Body() dto: CreateContainerMovementDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ContainerMovementResponseDto> {
    // recordedById comes from the access token, never from the body.
    return this.containerMovementsService.create(dto, request.user.sub);
  }

  @ApiOperation({
    summary:
      "Lista el libro de movimientos, paginado y filtrable por tipo, tipo de envase, locación y fecha",
  })
  @ApiResponse({ status: 200, type: PaginatedContainerMovementsDto })
  @Get()
  findAll(@Query() query: ListContainerMovementsQueryDto): Promise<PaginatedContainerMovementsDto> {
    return this.containerMovementsService.findAll(query);
  }

  @ApiOperation({
    summary: "Inventario: cantidad por tipo de envase y por estado, derivado del libro",
  })
  @ApiResponse({ status: 200, type: ContainerInventoryItemDto, isArray: true })
  @Get("inventory")
  inventory(): Promise<ContainerInventoryItemDto[]> {
    return this.containerMovementsService.inventory();
  }
}
