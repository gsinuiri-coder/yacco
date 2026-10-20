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
import { LocationTrackingResponseDto } from "./dto/location-tracking-response.dto.js";
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

  // The driver's phone reads it too: it is the one that sends the points.
  @ApiOperation({ summary: "Cada cuánto manda su ubicación el celular con la ruta en curso" })
  @ApiResponse({ status: 200, type: LocationTrackingResponseDto })
  @Roles(UserRole.ADMIN, UserRole.SELLER, UserRole.DRIVER)
  @Get("location-tracking")
  locationTracking(): LocationTrackingResponseDto {
    return this.settingsService.locationTracking();
  }
}
