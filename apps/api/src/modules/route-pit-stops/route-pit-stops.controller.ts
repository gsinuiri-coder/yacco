import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
import type { RouteActor } from "../routes/routes.service.js";
import { CreateRoutePitStopDto } from "./dto/create-route-pit-stop.dto.js";
import {
  RoutePitStopPreviewDto,
  RoutePitStopResponseDto,
} from "./dto/route-pit-stop-response.dto.js";
import { VoidRoutePitStopDto } from "./dto/void-route-pit-stop.dto.js";
import { RoutePitStopsService } from "./route-pit-stops.service.js";

function actorFrom(request: AuthenticatedRequest): RouteActor {
  return { id: request.user.sub, roles: request.user.roles };
}

@ApiTags("route-pit-stops")
@ApiBearerAuth()
@UseGuards(JwtAccessGuard, RolesGuard)
@Controller("routes/:id/pit-stops")
export class RoutePitStopsController {
  constructor(private readonly routePitStopsService: RoutePitStopsService) {}

  @ApiOperation({
    summary: "Valores esperados para una parada en planta según el libro en este momento",
    description:
      "Calcula envases llenos y vacíos arriba del camión y efectivo cobrado menos entregado en pits anteriores",
  })
  @ApiResponse({ status: 200, type: RoutePitStopPreviewDto })
  @ApiNotFoundResponse({ description: "La ruta no existe" })
  @ApiForbiddenResponse({ description: "Sin permisos para ver la ruta" })
  @Roles(UserRole.ADMIN, UserRole.SELLER)
  @Get("preview")
  preview(
    @Param("id", ParseUUIDPipe) routeId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<RoutePitStopPreviewDto> {
    return this.routePitStopsService.preview(routeId, actorFrom(request));
  }

  @ApiOperation({
    summary:
      "Registra una parada en planta (cuadre siempre, descarga, carga FIFO y entrega de efectivo opcionales)",
    description: "Operación atómica que solo se admite en rutas en curso",
  })
  @ApiResponse({ status: 201, type: RoutePitStopResponseDto })
  @ApiBadRequestResponse({ description: "Error de validación o stock insuficiente" })
  @ApiConflictResponse({ description: "La ruta no está en curso" })
  @ApiNotFoundResponse({ description: "La ruta no existe" })
  @ApiForbiddenResponse({ description: "Solo ADMIN o SELLER pueden registrar paradas en planta" })
  @Roles(UserRole.ADMIN, UserRole.SELLER)
  @Post()
  create(
    @Param("id", ParseUUIDPipe) routeId: string,
    @Body() dto: CreateRoutePitStopDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<RoutePitStopResponseDto> {
    return this.routePitStopsService.create(routeId, dto, actorFrom(request));
  }

  @ApiOperation({
    summary: "Lista las paradas en planta de la ruta",
    description: "El chofer solo puede ver las paradas de su propia ruta",
  })
  @ApiResponse({ status: 200, type: [RoutePitStopResponseDto] })
  @ApiNotFoundResponse({ description: "La ruta no existe" })
  @ApiForbiddenResponse({ description: "Sin permisos para ver la ruta" })
  @Roles(UserRole.ADMIN, UserRole.SELLER, UserRole.DRIVER)
  @Get()
  findAll(
    @Param("id", ParseUUIDPipe) routeId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<RoutePitStopResponseDto[]> {
    return this.routePitStopsService.findAll(routeId, actorFrom(request));
  }

  @ApiOperation({
    summary:
      "Anula la última parada en planta no anulada de la ruta (solo ADMIN con motivo obligatorio)",
    description: "Emite los movimientos inversos en la misma transacción y revierte el efectivo",
  })
  @ApiResponse({ status: 200, type: RoutePitStopResponseDto })
  @ApiBadRequestResponse({ description: "Falta el motivo de anulación" })
  @ApiConflictResponse({
    description:
      "La ruta ya está liquidada, la parada ya fue anulada o no es la última parada no anulada",
  })
  @ApiNotFoundResponse({ description: "La ruta o la parada no existen" })
  @ApiForbiddenResponse({ description: "Solo ADMIN puede anular una parada en planta" })
  @Roles(UserRole.ADMIN)
  @Patch(":pitStopId/void")
  voidPitStop(
    @Param("id", ParseUUIDPipe) routeId: string,
    @Param("pitStopId", ParseUUIDPipe) pitStopId: string,
    @Body() dto: VoidRoutePitStopDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<RoutePitStopResponseDto> {
    return this.routePitStopsService.voidPitStop(routeId, pitStopId, dto, actorFrom(request));
  }
}
