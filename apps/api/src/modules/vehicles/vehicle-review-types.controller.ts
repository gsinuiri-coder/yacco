import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
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
import { CreateVehicleReviewTypeDto } from "./dto/create-vehicle-review-type.dto.js";
import { UpdateVehicleReviewTypeDto } from "./dto/update-vehicle-review-type.dto.js";
import { VehicleReviewTypeResponseDto } from "./dto/vehicle-review-type-response.dto.js";
import { VehiclesService } from "./vehicles.service.js";

@ApiTags("vehicle-review-types")
@ApiBearerAuth()
@ApiForbiddenResponse({ description: "Authenticated but missing the required role" })
@UseGuards(JwtAccessGuard, RolesGuard)
@Controller("vehicle-review-types")
export class VehicleReviewTypesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  @ApiOperation({ summary: "Lista los tipos de revisión vehicular" })
  @ApiResponse({ status: 200, type: [VehicleReviewTypeResponseDto] })
  @Roles(UserRole.ADMIN, UserRole.SELLER, UserRole.DRIVER)
  @Get()
  findAll(
    @Query("includeInactive") includeInactive?: string,
    @Req() request?: AuthenticatedRequest,
  ): Promise<VehicleReviewTypeResponseDto[]> {
    const isAdmin = request?.user?.roles?.includes(UserRole.ADMIN) ?? false;
    const shouldInclude = isAdmin && includeInactive === "true";
    return this.vehiclesService.findAllReviewTypes(shouldInclude);
  }

  @ApiOperation({ summary: "Crea un nuevo tipo de revisión (solo ADMIN)" })
  @ApiResponse({ status: 201, type: VehicleReviewTypeResponseDto })
  @ApiBadRequestResponse({ description: "Nombre inválido" })
  @ApiConflictResponse({ description: "Nombre ya existente" })
  @Roles(UserRole.ADMIN)
  @Post()
  create(
    @Body() dto: CreateVehicleReviewTypeDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<VehicleReviewTypeResponseDto> {
    return this.vehiclesService.createReviewType(dto, request.user.sub);
  }

  @ApiOperation({ summary: "Activa o desactiva un tipo de revisión (solo ADMIN)" })
  @ApiResponse({ status: 200, type: VehicleReviewTypeResponseDto })
  @ApiNotFoundResponse({ description: "El tipo de revisión no existe" })
  @Roles(UserRole.ADMIN)
  @Patch(":id")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateVehicleReviewTypeDto,
  ): Promise<VehicleReviewTypeResponseDto> {
    return this.vehiclesService.updateReviewType(id, dto);
  }
}
