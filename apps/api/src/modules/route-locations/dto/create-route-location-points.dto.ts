import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsISO8601,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateNested,
} from "class-validator";
import { ACCURACY_PATTERN, COORDINATE_PATTERN } from "../../routes/dto/mark-route-stop.dto.js";

/**
 * A day of reparto at one point every 5 minutes is about 150 points; the
 * future offline app (Fase 3, fila 11) sends what it kept without signal in
 * one batch, so the cap leaves room for several days and still bounds the
 * request.
 */
export const MAX_LOCATION_POINTS_PER_BATCH = 500;

/**
 * OJO: `ROUTE_LOCATION_POINT` v1 de la cola del celular hereda esta clase
 * (sync/dto/route-location-point-payload.dto.ts). Cambiar lo que acepta
 * cambia lo que acepta un sobre que ya salió en una app: antes de tocarla, la
 * forma nueva va como v2 y la v1 se congela en su propia clase.
 */
export class RouteLocationPointInputDto {
  @ApiProperty({
    format: "uuid",
    description: "Lo genera el celular; el mismo punto mandado dos veces se guarda una",
  })
  @IsUUID("4", { message: "El identificador del punto debe ser un UUID" })
  clientPointId!: string;

  @ApiProperty({ type: String, example: "-12.046374" })
  @IsString({ message: "La latitud debe ser un texto decimal" })
  @Matches(COORDINATE_PATTERN, { message: "La latitud admite hasta 6 decimales" })
  @IsLatitude({ message: "La latitud debe estar entre -90 y 90" })
  latitude!: string;

  @ApiProperty({ type: String, example: "-77.042793" })
  @IsString({ message: "La longitud debe ser un texto decimal" })
  @Matches(COORDINATE_PATTERN, { message: "La longitud admite hasta 6 decimales" })
  @IsLongitude({ message: "La longitud debe estar entre -180 y 180" })
  longitude!: string;

  @ApiPropertyOptional({
    type: String,
    example: "12.50",
    description: "Precisión informada por el celular, en metros",
  })
  @IsOptional()
  @IsString({ message: "La precisión debe ser un texto decimal" })
  @Matches(ACCURACY_PATTERN, {
    message: "La precisión admite hasta 8 enteros y 2 decimales",
  })
  accuracyM?: string;

  @ApiProperty({
    format: "date-time",
    description: "Hora del celular al tomar la ubicación",
  })
  @IsISO8601({ strict: true }, { message: "La hora del punto debe ser una fecha y hora ISO" })
  recordedAt!: string;
}

export class CreateRouteLocationPointsDto {
  @ApiProperty({ type: RouteLocationPointInputDto, isArray: true })
  @IsArray()
  @ArrayNotEmpty({ message: "Mandá al menos un punto" })
  @ArrayMaxSize(MAX_LOCATION_POINTS_PER_BATCH, {
    message: `No se pueden mandar más de ${MAX_LOCATION_POINTS_PER_BATCH} puntos juntos`,
  })
  @ValidateNested({ each: true })
  @Type(() => RouteLocationPointInputDto)
  points!: RouteLocationPointInputDto[];
}
