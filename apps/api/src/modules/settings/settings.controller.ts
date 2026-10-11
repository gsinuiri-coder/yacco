import { Controller, Get, UseGuards } from "@nestjs/common";
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
import { PlantLocationResponseDto } from "./dto/plant-location-response.dto.js";
import { SettingsService } from "./settings.service.js";

@ApiTags("settings")
@ApiBearerAuth()
@ApiForbiddenResponse({ description: "Authenticated but missing an office role" })
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SELLER)
@Controller("settings")
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @ApiOperation({ summary: "Devuelve la ubicación configurada de la planta" })
  @ApiResponse({ status: 200, type: PlantLocationResponseDto })
  @Get("plant-location")
  plantLocation(): PlantLocationResponseDto {
    return this.settingsService.plantLocation();
  }
}
