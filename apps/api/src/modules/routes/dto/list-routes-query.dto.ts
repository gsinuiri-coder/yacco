import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min } from "class-validator";
import { RouteStatus } from "@prisma/client";
import { BUSINESS_DATE_MESSAGE, BUSINESS_DATE_PATTERN } from "../../orders/dto/create-order.dto.js";

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
// A plant runs a handful of routes a day; this cap only guards against a
// caller pulling the whole history in one call, same reasoning as orders.
export const MAX_LIMIT = 100;

export class ListRoutesQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: DEFAULT_PAGE })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: "La página debe ser un número entero" })
  @Min(1, { message: "La página debe ser 1 o mayor" })
  page: number = DEFAULT_PAGE;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: "El tamaño de página debe ser un número entero" })
  @Min(1, { message: "El tamaño de página debe ser 1 o mayor" })
  @Max(MAX_LIMIT, { message: `El tamaño de página no puede superar ${MAX_LIMIT}` })
  limit: number = DEFAULT_LIMIT;

  @ApiPropertyOptional({ example: "2026-08-25", description: "Fecha exacta de la ruta" })
  @IsOptional()
  @IsString({ message: `La fecha ${BUSINESS_DATE_MESSAGE}` })
  @Matches(BUSINESS_DATE_PATTERN, { message: `La fecha ${BUSINESS_DATE_MESSAGE}` })
  date?: string;

  // Ignored for a DRIVER: the service always scopes their list to their own
  // routes regardless of what this carries — see RoutesService.findAll.
  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID("4", { message: "El chofer debe ser un identificador válido" })
  driverId?: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID("4", { message: "La zona debe ser un identificador válido" })
  zoneId?: string;

  @ApiPropertyOptional({ enum: RouteStatus })
  @IsOptional()
  @IsEnum(RouteStatus, { message: "El estado no es un estado de ruta válido" })
  status?: RouteStatus;
}
