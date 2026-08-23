import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import {
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
import { ContainerTypesService } from "./container-types.service.js";
import { ContainerTypeResponseDto } from "./dto/container-type-response.dto.js";
import { ListContainerTypesQueryDto } from "./dto/list-container-types-query.dto.js";

/**
 * Read-only catalog: ADMIN captures production batches and ADMIN/SELLER
 * register movements against it (spec has no container-type CRUD, the
 * catalog is seeded — "con caño" / "sin caño"). Same roles as Products.
 */
@ApiTags("container-types")
@ApiBearerAuth()
@ApiForbiddenResponse({ description: "Authenticated but missing the ADMIN or SELLER role" })
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SELLER)
@Controller("container-types")
export class ContainerTypesController {
  constructor(private readonly containerTypesService: ContainerTypesService) {}

  @ApiOperation({ summary: "Lista el catálogo de tipos de envase (sin paginar)" })
  @ApiResponse({ status: 200, type: ContainerTypeResponseDto, isArray: true })
  @Get()
  findAll(@Query() query: ListContainerTypesQueryDto): Promise<ContainerTypeResponseDto[]> {
    return this.containerTypesService.findAll(query);
  }
}
