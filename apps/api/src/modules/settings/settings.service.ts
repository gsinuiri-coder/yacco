import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { LocationTrackingResponseDto } from "./dto/location-tracking-response.dto.js";
import { PlantLocationResponseDto } from "./dto/plant-location-response.dto.js";

/** Every 5 minutes (Fase 3, fila 10) unless LOCATION_INTERVAL_SECONDS says otherwise. */
export const DEFAULT_LOCATION_INTERVAL_SECONDS = 300;

@Injectable()
export class SettingsService {
  constructor(private readonly configService: ConfigService) {}

  plantLocation(): PlantLocationResponseDto {
    return {
      latitude: this.configService.get<string>("PLANT_LATITUDE") ?? null,
      longitude: this.configService.get<string>("PLANT_LONGITUDE") ?? null,
    };
  }

  locationTracking(): LocationTrackingResponseDto {
    const configured = this.configService.get<number | string>("LOCATION_INTERVAL_SECONDS");
    return {
      intervalSeconds:
        configured === undefined ? DEFAULT_LOCATION_INTERVAL_SECONDS : Number(configured),
    };
  }
}
