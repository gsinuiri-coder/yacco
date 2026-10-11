import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PlantLocationResponseDto } from "./dto/plant-location-response.dto.js";

@Injectable()
export class SettingsService {
  constructor(private readonly configService: ConfigService) {}

  plantLocation(): PlantLocationResponseDto {
    return {
      latitude: this.configService.get<string>("PLANT_LATITUDE") ?? null,
      longitude: this.configService.get<string>("PLANT_LONGITUDE") ?? null,
    };
  }
}
