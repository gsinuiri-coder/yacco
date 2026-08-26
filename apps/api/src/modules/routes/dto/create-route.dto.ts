import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, IsUUID, Matches } from "class-validator";
import { BUSINESS_DATE_MESSAGE, BUSINESS_DATE_PATTERN } from "../../orders/dto/create-order.dto.js";

/**
 * `status` is deliberately absent: a route is always born PLANNED. `zoneId`
 * is optional — not every driver's day is scoped to a single zone.
 * `createdById` is absent too — it comes from the access token.
 */
export class CreateRouteDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID("4", { message: "El chofer debe ser un identificador válido" })
  driverId!: string;

  @ApiProperty({ example: "2026-08-25", description: "Día de la ruta (America/Lima)" })
  @IsString({ message: `La fecha ${BUSINESS_DATE_MESSAGE}` })
  @Matches(BUSINESS_DATE_PATTERN, { message: `La fecha ${BUSINESS_DATE_MESSAGE}` })
  date!: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID("4", { message: "La zona debe ser un identificador válido" })
  zoneId?: string;
}
