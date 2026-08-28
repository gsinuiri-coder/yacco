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
import { ContainerTypesService } from "./container-types.service.js";
import { ContainerTypeResponseDto } from "./dto/container-type-response.dto.js";
import { CreateContainerTypeDto } from "./dto/create-container-type.dto.js";
import { ListContainerTypesQueryDto } from "./dto/list-container-types-query.dto.js";
import { UpdateContainerTypeDto } from "./dto/update-container-type.dto.js";

/**
 * Manageable catalog. It used to be read-only on the premise that the spec
 * seeded two constants ("con caño" / "sin caño") and nothing else; that
 * premise fell: the plant tells its containers apart by label — (V), (R) —
 * which are distinct types for the inventory, and when one runs short the
 * owner hands out another. They are types the office manages, not two
 * constants.
 *
 * Roles are asymmetric on purpose. Reading stays ADMIN and SELLER: whoever
 * registers movements needs the catalog to register them against. Writing
 * is ADMIN only: creating or withdrawing a type changes what can be
 * counted and inventoried, and that is an office decision. The method-level
 * @Roles below overrides the class-level one (RolesGuard uses
 * getAllAndOverride, handler first).
 */
@ApiTags("container-types")
@ApiBearerAuth()
@ApiForbiddenResponse({ description: "Authenticated but missing the required role" })
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SELLER)
@Controller("container-types")
export class ContainerTypesController {
  constructor(private readonly containerTypesService: ContainerTypesService) {}

  @ApiOperation({ summary: "Crea un tipo de envase (solo ADMIN)" })
  @ApiResponse({ status: 201, type: ContainerTypeResponseDto })
  @ApiBadRequestResponse({ description: "Validation failed, or the name already exists" })
  @Roles(UserRole.ADMIN)
  @Post()
  create(@Body() dto: CreateContainerTypeDto): Promise<ContainerTypeResponseDto> {
    return this.containerTypesService.create(dto);
  }

  @ApiOperation({ summary: "Lista el catálogo de tipos de envase (sin paginar)" })
  @ApiResponse({ status: 200, type: ContainerTypeResponseDto, isArray: true })
  @Get()
  findAll(@Query() query: ListContainerTypesQueryDto): Promise<ContainerTypeResponseDto[]> {
    return this.containerTypesService.findAll(query);
  }

  // Sin consumidor en apps/web, y así se queda: mismo
  // ContainerTypeResponseDto que un elemento del listado (los dos usan
  // CONTAINER_TYPE_SELECT), y la API embebe {id, name} en toda referencia a
  // tipo de envase. Quien lo va a necesitar es el móvil, para resolver un id
  // suelto cuando su copia local del catálogo quedó vieja (spec §4.3,
  // POST /sync/operations). Ver docs/estado-por-modulo.md.
  @ApiOperation({ summary: "Un tipo de envase por id" })
  @ApiResponse({ status: 200, type: ContainerTypeResponseDto })
  @ApiNotFoundResponse({ description: "Container type id does not exist" })
  @Get(":id")
  findOne(@Param("id", ParseUUIDPipe) id: string): Promise<ContainerTypeResponseDto> {
    return this.containerTypesService.findOne(id);
  }

  // Withdrawing is `active: false` through this route. There is no DELETE:
  // see ContainerTypesService for why a type can never be hard-deleted.
  @ApiOperation({ summary: "Renombra o retira/reactiva un tipo de envase (solo ADMIN)" })
  @ApiResponse({ status: 200, type: ContainerTypeResponseDto })
  @ApiNotFoundResponse({ description: "Container type id does not exist" })
  @ApiBadRequestResponse({ description: "Validation failed, or the name already exists" })
  @Roles(UserRole.ADMIN)
  @Patch(":id")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateContainerTypeDto,
  ): Promise<ContainerTypeResponseDto> {
    return this.containerTypesService.update(id, dto);
  }
}
