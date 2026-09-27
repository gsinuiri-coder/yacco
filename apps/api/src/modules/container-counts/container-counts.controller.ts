import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
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
import { ContainerCountsService } from "./container-counts.service.js";
import { CreateContainerCountDto } from "./dto/create-container-count.dto.js";
import { ContainerCountResponseDto } from "./dto/container-count-response.dto.js";
import { CreatePlantCountDto } from "./dto/create-plant-count.dto.js";
import { PlantCountResponseDto } from "./dto/plant-count-response.dto.js";

/**
 * ADMIN and SELLER register counts (office capture, same phase as
 * container-movements); DRIVER field writes arrive later through the sync
 * endpoint. There is deliberately no PATCH/DELETE/GET route yet — the count
 * book is append-only, and read/reporting is a later PR.
 */
@ApiTags("container-counts")
@ApiBearerAuth()
@ApiForbiddenResponse({ description: "Authenticated but missing the ADMIN or SELLER role" })
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SELLER)
@Controller("container-counts")
export class ContainerCountsController {
  constructor(private readonly containerCountsService: ContainerCountsService) {}

  @ApiOperation({
    summary: "Registra un conteo físico y emite el ajuste al libro si hay diferencia",
  })
  @ApiResponse({ status: 201, type: ContainerCountResponseDto })
  @ApiBadRequestResponse({
    description: "Validation failed, or a referenced container type or location does not exist",
  })
  @Post()
  create(
    @Body() dto: CreateContainerCountDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ContainerCountResponseDto> {
    // countedById comes from the access token, never from the body.
    return this.containerCountsService.create(dto, request.user.sub);
  }

  /**
   * Solo ADMIN: el conteo de la planta cambia el stock con que se cargan las
   * rutas (descuenta llenos de los lotes), así que no es trabajo de oficina.
   */
  @ApiOperation({
    summary: "Registra el conteo de vacíos o llenos en la planta y ajusta el libro a lo contado",
  })
  @ApiResponse({ status: 201, type: PlantCountResponseDto })
  @ApiBadRequestResponse({
    description:
      "Validation failed, the container type does not exist, or more fulls were counted than the ledger has",
  })
  @Roles(UserRole.ADMIN)
  @Post("plant")
  countPlant(
    @Body() dto: CreatePlantCountDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<PlantCountResponseDto> {
    return this.containerCountsService.countPlant(dto, request.user.sub);
  }
}
