import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import { CreateRouteLoadDto } from "./dto/create-route-load.dto.js";
import { CreateRouteStopDto } from "./dto/create-route-stop.dto.js";
import { CreateRouteDto } from "./dto/create-route.dto.js";
import { FindRouteQueryDto } from "./dto/find-route-query.dto.js";
import { ListRoutesQueryDto } from "./dto/list-routes-query.dto.js";
import { MarkRouteStopDto } from "./dto/mark-route-stop.dto.js";
import { ReorderRouteStopsDto } from "./dto/reorder-route-stops.dto.js";
import { RouteLoadResponseDto } from "./dto/route-load-response.dto.js";
import {
  PaginatedRoutesDto,
  RouteResponseDto,
  RouteStopResponseDto,
} from "./dto/route-response.dto.js";
import { RoutesService } from "./routes.service.js";
import type { RouteActor } from "./routes.service.js";

function actorFrom(request: AuthenticatedRequest): RouteActor {
  return { id: request.user.sub, roles: request.user.roles };
}

/**
 * ADMIN and SELLER plan and see every route; DRIVER only operates their own.
 * That per-resource ownership check has no guard to express it — RolesGuard
 * only knows the declared @Roles metadata, never a specific route's
 * driverId — so all three roles pass the class-level guard here and
 * RoutesService does the finer check against each route it loads.
 */
@ApiTags("routes")
@ApiBearerAuth()
@ApiForbiddenResponse({
  description:
    "Authenticated but missing the required role, or a DRIVER touching another driver's route",
})
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SELLER, UserRole.DRIVER)
@Controller("routes")
export class RoutesController {
  constructor(private readonly routesService: RoutesService) {}

  // Planning is office work (spec HU-10: "Como administrador..."); a DRIVER
  // only ever operates a route once ADMIN/SELLER already created it.
  @ApiOperation({ summary: "Planifica la ruta del día para un chofer" })
  @ApiResponse({ status: 201, type: RouteResponseDto })
  @ApiBadRequestResponse({
    description: "Validation failed, the driver/zone is missing, or the driver is not eligible",
  })
  @Roles(UserRole.ADMIN, UserRole.SELLER)
  @Post()
  create(
    @Body() dto: CreateRouteDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<RouteResponseDto> {
    // createdById comes from the access token, never from the body.
    return this.routesService.create(dto, request.user.sub);
  }

  @ApiOperation({ summary: "Lista rutas paginadas, con filtros por fecha, chofer, zona y estado" })
  @ApiResponse({ status: 200, type: PaginatedRoutesDto })
  @Get()
  findAll(
    @Query() query: ListRoutesQueryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<PaginatedRoutesDto> {
    return this.routesService.findAll(query, actorFrom(request));
  }

  @ApiOperation({
    summary: "Detalle de una ruta con sus paradas ordenadas",
    description: "?stopStatus=PENDING muestra solo lo que le falta resolver a la oficina",
  })
  @ApiResponse({ status: 200, type: RouteResponseDto })
  @ApiNotFoundResponse({ description: "Route id does not exist" })
  @Get(":id")
  findOne(
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: FindRouteQueryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<RouteResponseDto> {
    return this.routesService.findOne(id, actorFrom(request), query);
  }

  @ApiOperation({ summary: "Inicia la ruta: PLANNED -> IN_PROGRESS" })
  @ApiResponse({ status: 200, type: RouteResponseDto })
  @ApiNotFoundResponse({ description: "Route id does not exist" })
  @ApiConflictResponse({ description: "Route is not PLANNED" })
  @Patch(":id/start")
  start(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<RouteResponseDto> {
    return this.routesService.start(id, actorFrom(request));
  }

  @ApiOperation({ summary: "Termina la ruta: IN_PROGRESS -> FINISHED" })
  @ApiResponse({ status: 200, type: RouteResponseDto })
  @ApiNotFoundResponse({ description: "Route id does not exist" })
  @ApiConflictResponse({ description: "Route is not IN_PROGRESS" })
  @Patch(":id/finish")
  finish(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<RouteResponseDto> {
    return this.routesService.finish(id, actorFrom(request));
  }

  @ApiOperation({ summary: "Agrega una parada a la ruta" })
  @ApiResponse({ status: 201, type: RouteStopResponseDto })
  @ApiNotFoundResponse({ description: "Route id does not exist" })
  @ApiBadRequestResponse({
    description:
      "Validation failed, the order/location is missing, or the order is already assigned",
  })
  @ApiConflictResponse({ description: "Route is FINISHED" })
  @Post(":id/stops")
  addStop(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CreateRouteStopDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<RouteStopResponseDto> {
    return this.routesService.addStop(id, dto, actorFrom(request));
  }

  // Declared BEFORE ":id/stops/:stopId": Nest matches routes in registration
  // order, so "reorder" would otherwise be captured as a :stopId value.
  @ApiOperation({ summary: "Reordena las paradas de la ruta" })
  @ApiResponse({ status: 200, type: RouteResponseDto })
  @ApiNotFoundResponse({ description: "Route id does not exist" })
  @ApiBadRequestResponse({
    description: "The list is incomplete or names a stop from another route",
  })
  @ApiConflictResponse({ description: "Route is FINISHED" })
  @Patch(":id/stops/reorder")
  reorderStops(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ReorderRouteStopsDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<RouteResponseDto> {
    return this.routesService.reorderStops(id, dto, actorFrom(request));
  }

  // Known gap, accepted deliberately (not an oversight): spec §4.3 says field
  // writes from a driver enter through ONE idempotent door, POST
  // /sync/operations, never an individual endpoint — and HU-12/HU-13 (what
  // DELIVERED now registers) are S6/S7 "móvil offline" stories, built on a
  // sync module that doesn't exist yet. Until it does, this classic REST
  // PATCH is the DRIVER's only way to register a delivery, same as it
  // already was for the plain status flip before this PR. Revisit — tighten
  // this to ADMIN/SELLER only, or move the write behind /sync/operations —
  // once the sync module ships.
  @ApiOperation({
    summary: "Marca una parada como entregada o fallida",
    description:
      "DELIVERED registra la venta, los movimientos de envases en ambos sentidos y el cobro si lo hubo, todo en una transacción",
  })
  @ApiResponse({ status: 200, type: RouteStopResponseDto })
  @ApiNotFoundResponse({ description: "Route or stop id does not exist" })
  @ApiBadRequestResponse({
    description:
      "Validation failed, a product/payment method doesn't exist, or a price override with no authorizer",
  })
  @ApiConflictResponse({
    description: "Route is not IN_PROGRESS, or the stop is no longer PENDING (already resolved)",
  })
  @Patch(":id/stops/:stopId")
  markStop(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("stopId", ParseUUIDPipe) stopId: string,
    @Body() dto: MarkRouteStopDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<RouteStopResponseDto> {
    return this.routesService.markStop(id, stopId, dto, actorFrom(request));
  }

  // Cargo is office work, same as planning: a DRIVER only ever reads what
  // was loaded onto their own truck (see the class-level ownership note).
  @ApiOperation({ summary: "Carga unidades de un ítem de lote al camión de la ruta" })
  @ApiResponse({ status: 201, type: RouteLoadResponseDto })
  @ApiNotFoundResponse({ description: "Route id does not exist" })
  @ApiBadRequestResponse({
    description: "Validation failed, the batch item is missing, or there isn't enough stock",
  })
  @ApiConflictResponse({ description: "Route is FINISHED" })
  @Roles(UserRole.ADMIN, UserRole.SELLER)
  @Post(":id/loads")
  addLoad(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CreateRouteLoadDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<RouteLoadResponseDto> {
    return this.routesService.addLoad(id, dto, actorFrom(request));
  }

  @ApiOperation({ summary: "Lista lo cargado en la ruta" })
  @ApiResponse({ status: 200, type: RouteLoadResponseDto, isArray: true })
  @ApiNotFoundResponse({ description: "Route id does not exist" })
  @Get(":id/loads")
  listLoads(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<RouteLoadResponseDto[]> {
    return this.routesService.listLoads(id, actorFrom(request));
  }

  @ApiOperation({ summary: "Corrige una carga mal ingresada (solo con la ruta PLANNED)" })
  @ApiResponse({ status: 204, description: "La carga se borró y el stock volvió al lote" })
  @ApiNotFoundResponse({ description: "Route or load id does not exist" })
  @ApiConflictResponse({ description: "Route is no longer PLANNED" })
  @Roles(UserRole.ADMIN, UserRole.SELLER)
  @HttpCode(204)
  @Delete(":id/loads/:loadId")
  removeLoad(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("loadId", ParseUUIDPipe) loadId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    return this.routesService.removeLoad(id, loadId, actorFrom(request));
  }
}
