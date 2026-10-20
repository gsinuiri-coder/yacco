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
import { CreateRouteLocationPointsDto } from "./dto/create-route-location-points.dto.js";
import {
  LiveRouteLocationsDto,
  RouteLocationPointDto,
  RouteLocationPointsReceiptDto,
} from "./dto/route-location-response.dto.js";
import { RouteLocationsService } from "./route-locations.service.js";

@ApiTags("route-locations")
@ApiBearerAuth()
@UseGuards(JwtAccessGuard, RolesGuard)
@Controller("routes/:id/location-points")
export class RouteLocationPointsController {
  constructor(private readonly routeLocationsService: RouteLocationsService) {}

  @ApiOperation({
    summary: "Recibe un lote de ubicaciones del celular del chofer",
    description:
      "Solo el chofer de la ruta y solo con la ruta en curso. Idempotente por clientPointId: un punto repetido se guarda una vez.",
  })
  @ApiResponse({ status: 201, type: RouteLocationPointsReceiptDto })
  @ApiBadRequestResponse({ description: "Un punto no es válido" })
  @ApiForbiddenResponse({ description: "La ruta es de otro chofer" })
  @ApiNotFoundResponse({ description: "La ruta no existe" })
  @ApiConflictResponse({ description: "La ruta no está en curso" })
  @Roles(UserRole.DRIVER)
  @Post()
  record(
    @Param("id", ParseUUIDPipe) routeId: string,
    @Body() dto: CreateRouteLocationPointsDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<RouteLocationPointsReceiptDto> {
    return this.routeLocationsService.recordPoints(routeId, dto, {
      id: request.user.sub,
      roles: request.user.roles,
    });
  }

  @ApiOperation({ summary: "Recorrido de la ruta: sus puntos en orden de hora" })
  @ApiResponse({ status: 200, type: RouteLocationPointDto, isArray: true })
  @ApiNotFoundResponse({ description: "La ruta no existe" })
  @Roles(UserRole.ADMIN, UserRole.SELLER)
  @Get()
  list(@Param("id", ParseUUIDPipe) routeId: string): Promise<RouteLocationPointDto[]> {
    return this.routeLocationsService.listRoutePoints(routeId);
  }
}

@ApiTags("route-locations")
@ApiBearerAuth()
@ApiForbiddenResponse({ description: "Authenticated but missing an office role" })
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SELLER)
@Controller("route-locations")
export class RouteLocationsController {
  constructor(private readonly routeLocationsService: RouteLocationsService) {}

  @ApiOperation({
    summary: "Último punto de cada ruta en curso, con la marca «sin señal»",
  })
  @ApiResponse({ status: 200, type: LiveRouteLocationsDto })
  @Get("latest")
  latest(): Promise<LiveRouteLocationsDto> {
    return this.routeLocationsService.listLive();
  }
}
