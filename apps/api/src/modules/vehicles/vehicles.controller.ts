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
import { CreateVehicleDto } from "./dto/create-vehicle.dto.js";
import { UpdateVehicleDto } from "./dto/update-vehicle.dto.js";
import { VehicleResponseDto } from "./dto/vehicle-response.dto.js";
import { CreateVehicleReviewDto } from "./dto/create-vehicle-review.dto.js";
import { VoidVehicleReviewDto } from "./dto/void-vehicle-review.dto.js";
import {
  VehicleReviewResponseDto,
  VehicleReviewTypeStatusDto,
} from "./dto/vehicle-review-response.dto.js";
import { UpcomingReviewAlertDto } from "./dto/upcoming-reviews-response.dto.js";
import { VehiclesService } from "./vehicles.service.js";

@ApiTags("vehicles")
@ApiBearerAuth()
@ApiForbiddenResponse({ description: "Authenticated but missing the required role" })
@UseGuards(JwtAccessGuard, RolesGuard)
@Controller("vehicles")
export class VehiclesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  @ApiOperation({
    summary: "Lista alertas de revisiones vehiculares y licencias por vencer o vencidas",
  })
  @ApiResponse({ status: 200, type: [UpcomingReviewAlertDto] })
  @Roles(UserRole.ADMIN, UserRole.SELLER)
  @Get("upcoming-reviews")
  getUpcomingAlerts(): Promise<UpcomingReviewAlertDto[]> {
    return this.vehiclesService.getUpcomingReviewAlerts();
  }

  @ApiOperation({ summary: "Lista vehículos del catálogo" })
  @ApiResponse({ status: 200, type: [VehicleResponseDto] })
  @Roles(UserRole.ADMIN, UserRole.SELLER, UserRole.DRIVER)
  @Get()
  findAll(
    @Query("includeInactive") includeInactive?: string,
    @Req() request?: AuthenticatedRequest,
  ): Promise<VehicleResponseDto[]> {
    const isAdmin = request?.user?.roles?.includes(UserRole.ADMIN) ?? false;
    const shouldInclude = isAdmin && includeInactive === "true";
    return this.vehiclesService.findAllVehicles(shouldInclude);
  }

  @ApiOperation({ summary: "Obtiene un vehículo por ID" })
  @ApiResponse({ status: 200, type: VehicleResponseDto })
  @ApiNotFoundResponse({ description: "El vehículo no existe" })
  @Roles(UserRole.ADMIN, UserRole.SELLER, UserRole.DRIVER)
  @Get(":id")
  findOne(@Param("id", ParseUUIDPipe) id: string): Promise<VehicleResponseDto> {
    return this.vehiclesService.findOneVehicle(id);
  }

  @ApiOperation({ summary: "Crea un nuevo vehículo en el catálogo (solo ADMIN)" })
  @ApiResponse({ status: 201, type: VehicleResponseDto })
  @ApiBadRequestResponse({ description: "Datos inválidos" })
  @ApiConflictResponse({ description: "Placa duplicada" })
  @Roles(UserRole.ADMIN)
  @Post()
  create(
    @Body() dto: CreateVehicleDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<VehicleResponseDto> {
    return this.vehiclesService.createVehicle(dto, request.user.sub);
  }

  @ApiOperation({ summary: "Actualiza datos o estado de un vehículo (solo ADMIN)" })
  @ApiResponse({ status: 200, type: VehicleResponseDto })
  @ApiNotFoundResponse({ description: "El vehículo no existe" })
  @ApiConflictResponse({
    description: "La placa no puede modificarse si ya estuvo en una ruta, o placa duplicada",
  })
  @Roles(UserRole.ADMIN)
  @Patch(":id")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateVehicleDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<VehicleResponseDto> {
    return this.vehiclesService.updateVehicle(id, dto, request.user.sub);
  }

  // --- REVIEWS ---

  @ApiOperation({ summary: "Lista las revisiones históricas de un vehículo" })
  @ApiResponse({ status: 200, type: [VehicleReviewResponseDto] })
  @ApiNotFoundResponse({ description: "El vehículo no existe" })
  @Roles(UserRole.ADMIN, UserRole.SELLER, UserRole.DRIVER)
  @Get(":id/reviews")
  findAllReviews(@Param("id", ParseUUIDPipe) id: string): Promise<VehicleReviewResponseDto[]> {
    return this.vehiclesService.findAllReviewsByVehicle(id);
  }

  @ApiOperation({ summary: "Obtiene el estado actual de cada tipo de revisión para un vehículo" })
  @ApiResponse({ status: 200, type: [VehicleReviewTypeStatusDto] })
  @ApiNotFoundResponse({ description: "El vehículo no existe" })
  @Roles(UserRole.ADMIN, UserRole.SELLER, UserRole.DRIVER)
  @Get(":id/reviews-status")
  getReviewsStatus(@Param("id", ParseUUIDPipe) id: string): Promise<VehicleReviewTypeStatusDto[]> {
    return this.vehiclesService.getVehicleReviewsStatus(id);
  }

  @ApiOperation({ summary: "Registra una nueva revisión con fecha de vencimiento" })
  @ApiResponse({ status: 201, type: VehicleReviewResponseDto })
  @ApiBadRequestResponse({
    description: "Fecha de vencimiento anterior a fecha de inicio, o tipo inactivo",
  })
  @ApiNotFoundResponse({ description: "El vehículo no existe" })
  @Roles(UserRole.ADMIN, UserRole.SELLER)
  @Post(":id/reviews")
  createReview(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CreateVehicleReviewDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<VehicleReviewResponseDto> {
    return this.vehiclesService.createReview(id, dto, request.user.sub);
  }

  @ApiOperation({ summary: "Anula una revisión registrada por error (solo ADMIN)" })
  @ApiResponse({ status: 200, type: VehicleReviewResponseDto })
  @ApiBadRequestResponse({ description: "Motivo de anulación obligatorio" })
  @ApiNotFoundResponse({ description: "La revisión no existe" })
  @ApiConflictResponse({ description: "La revisión ya fue anulada" })
  @Roles(UserRole.ADMIN)
  @Patch(":id/reviews/:reviewId/void")
  voidReview(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("reviewId", ParseUUIDPipe) reviewId: string,
    @Body() dto: VoidVehicleReviewDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<VehicleReviewResponseDto> {
    return this.vehiclesService.voidReview(id, reviewId, dto, request.user.sub);
  }
}
