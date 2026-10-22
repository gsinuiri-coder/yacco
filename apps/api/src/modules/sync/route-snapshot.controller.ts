import { Controller, Get, HttpStatus, Query, Req, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
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
import { RouteSnapshotDto, RouteSnapshotQueryDto } from "./dto/route-snapshot.dto.js";
import { RouteSnapshotService } from "./route-snapshot.service.js";

@ApiTags("sync")
@ApiBearerAuth()
@ApiForbiddenResponse({ description: "Sin el rol, o la ruta es de otro chofer" })
@UseGuards(JwtAccessGuard, RolesGuard)
@Controller("sync/route-snapshot")
export class RouteSnapshotController {
  constructor(private readonly routeSnapshotService: RouteSnapshotService) {}

  @ApiOperation({
    summary: "Lo que la app del chofer guarda para trabajar su ruta sin señal",
    description:
      "La ruta del chofer en curso o la de hoy, con la deuda, los envases, los accesorios y los precios de cada local, y los catálogos de la parada. Solo la usa la app.",
  })
  @ApiResponse({ status: HttpStatus.OK, type: RouteSnapshotDto })
  @ApiNotFoundResponse({ description: "No tiene ruta hoy, o esa ruta no es la de hoy" })
  @Roles(UserRole.DRIVER, UserRole.ADMIN)
  @Get()
  build(
    @Query() query: RouteSnapshotQueryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<RouteSnapshotDto> {
    return this.routeSnapshotService.build(query, {
      id: request.user.sub,
      roles: request.user.roles,
    });
  }
}
