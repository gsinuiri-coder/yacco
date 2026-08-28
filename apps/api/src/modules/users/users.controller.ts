import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
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
import { CreateUserDto } from "./dto/create-user.dto.js";
import { ListUsersQueryDto } from "./dto/list-users-query.dto.js";
import { UpdateUserDto } from "./dto/update-user.dto.js";
import { UserResponseDto } from "./dto/user-response.dto.js";
import { UsersService } from "./users.service.js";

@ApiTags("users")
@ApiBearerAuth()
@ApiForbiddenResponse({ description: "Authenticated but missing the ADMIN role" })
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @ApiOperation({
    summary: "Lista usuarios, filtrando opcionalmente por rol y por estado activo/desactivado",
  })
  @ApiResponse({ status: 200, type: UserResponseDto, isArray: true })
  // RoutesController permite @Roles(ADMIN, SELLER) en create: un vendedor
  // planifica rutas, y ese formulario necesita listar choferes. El @Roles
  // del método pisa al de la clase (reflector.getAllAndOverride en
  // RolesGuard), así que POST y PATCH siguen siendo solo ADMIN.
  @Roles(UserRole.ADMIN, UserRole.SELLER)
  @Get()
  findAll(@Query() query: ListUsersQueryDto): Promise<UserResponseDto[]> {
    return this.usersService.findAll(query);
  }

  @ApiResponse({ status: 201, type: UserResponseDto })
  @ApiConflictResponse({ description: "Username already taken" })
  @Post()
  create(@Body() dto: CreateUserDto): Promise<UserResponseDto> {
    return this.usersService.create(dto);
  }

  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiNotFoundResponse({ description: "User id does not exist" })
  @ApiBadRequestResponse({
    description: "Validation failed, or the actor tried to deactivate or demote themselves",
  })
  @Patch(":id")
  // El actor sale del token, nunca del body: quién manda el cambio es lo que
  // decide si la guarda de auto-degradación aplica, y eso no puede venir del
  // cliente. Mismo patrón que `actorFrom` en routes.controller.ts.
  update(
    @Param("id") id: string,
    @Body() dto: UpdateUserDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<UserResponseDto> {
    return this.usersService.update(id, dto, request.user.sub);
  }
}
