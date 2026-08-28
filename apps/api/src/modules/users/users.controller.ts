import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
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
  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateUserDto): Promise<UserResponseDto> {
    return this.usersService.update(id, dto);
  }
}
