import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
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
import type { AuthenticatedRequest } from "../auth/types/authenticated-request.js";
import { CreateIssuerSettingsDto } from "./dto/create-issuer-settings.dto.js";
import { IssuerSettingsResponseDto } from "./dto/issuer-settings-response.dto.js";
import { IssuerSettingsService } from "./issuer-settings.service.js";

@ApiTags("issuer-settings")
@ApiBearerAuth()
@ApiForbiddenResponse({ description: "Solo el administrador configura datos de facturación" })
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller("issuer-settings")
export class IssuerSettingsController {
  constructor(private readonly issuerSettingsService: IssuerSettingsService) {}

  @ApiOperation({ summary: "Obtiene la versión vigente de los datos de facturación" })
  @ApiResponse({ status: 200, type: IssuerSettingsResponseDto })
  @Get("current")
  getCurrent(): Promise<IssuerSettingsResponseDto | null> {
    return this.issuerSettingsService.getCurrent();
  }

  @ApiOperation({ summary: "Crea una nueva versión de los datos de facturación" })
  @ApiResponse({ status: 201, type: IssuerSettingsResponseDto })
  @Post()
  create(
    @Body() dto: CreateIssuerSettingsDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<IssuerSettingsResponseDto> {
    return this.issuerSettingsService.create(dto, request.user.sub);
  }
}
