import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
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
import { CreateZoneDto } from "./dto/create-zone.dto.js";
import { ListZonesQueryDto } from "./dto/list-zones-query.dto.js";
import { UpdateZoneDto } from "./dto/update-zone.dto.js";
import { ZoneResponseDto } from "./dto/zone-response.dto.js";
import { ZonesService } from "./zones.service.js";

/**
 * Manageable catalog. Zones were empty in production with no way to create
 * one but a hand-written INSERT; the owner groups the work by zone, so the
 * office manages them here.
 *
 * Roles are asymmetric on purpose, the same way as container-types.
 * Reading stays ADMIN and SELLER: whoever registers a customer or filters
 * a report needs the catalog to do it against. Writing is ADMIN only:
 * creating or withdrawing a zone changes how the roster and the audit are
 * grouped, and that is an office decision. The method-level @Roles below
 * overrides the class-level one (RolesGuard uses getAllAndOverride,
 * handler first).
 */
@ApiTags("zones")
@ApiBearerAuth()
@ApiForbiddenResponse({ description: "Authenticated but missing the required role" })
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SELLER)
@Controller("zones")
export class ZonesController {
  constructor(private readonly zonesService: ZonesService) {}

  @ApiOperation({ summary: "Crea una zona (solo ADMIN)" })
  @ApiResponse({ status: 201, type: ZoneResponseDto })
  @ApiBadRequestResponse({ description: "Validation failed, or the name already exists" })
  @Roles(UserRole.ADMIN)
  @Post()
  create(@Body() dto: CreateZoneDto): Promise<ZoneResponseDto> {
    return this.zonesService.create(dto);
  }

  @ApiOperation({ summary: "Lista el catálogo de zonas (sin paginar)" })
  @ApiResponse({ status: 200, type: ZoneResponseDto, isArray: true })
  @Get()
  findAll(@Query() query: ListZonesQueryDto): Promise<ZoneResponseDto[]> {
    return this.zonesService.findAll(query);
  }

  @ApiOperation({ summary: "Una zona por id" })
  @ApiResponse({ status: 200, type: ZoneResponseDto })
  @ApiNotFoundResponse({ description: "Zone id does not exist" })
  @Get(":id")
  findOne(@Param("id", ParseUUIDPipe) id: string): Promise<ZoneResponseDto> {
    return this.zonesService.findOne(id);
  }

  // Withdrawing is `active: false` through this route. There is no DELETE:
  // see ZonesService for why a zone can never be hard-deleted.
  @ApiOperation({ summary: "Renombra, cambia los días o retira/reactiva una zona (solo ADMIN)" })
  @ApiResponse({ status: 200, type: ZoneResponseDto })
  @ApiNotFoundResponse({ description: "Zone id does not exist" })
  @ApiBadRequestResponse({ description: "Validation failed, or the name already exists" })
  @Roles(UserRole.ADMIN)
  @Patch(":id")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateZoneDto,
  ): Promise<ZoneResponseDto> {
    return this.zonesService.update(id, dto);
  }
}
