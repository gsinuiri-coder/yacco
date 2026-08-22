import { ApiPropertyOptional } from "@nestjs/swagger";
import { ContainerMovementType } from "@prisma/client";
import { Type } from "class-transformer";
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min } from "class-validator";

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
// A busy day can log a movement per stop per container type; an uncapped
// page size would let one call pull the whole ledger.
export const MAX_LIMIT = 100;

// Calendar date in America/Lima — the same wire shape as orders' delivery
// date — even though `occurred_at` itself is a timestamptz: a "from/to"
// filter here means a business day, not a raw instant, and the service
// converts each end to its UTC boundary (Lima is UTC-5, no DST) before
// touching the database.
export const BUSINESS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const BUSINESS_DATE_MESSAGE = "debe tener el formato AAAA-MM-DD";

export class ListContainerMovementsQueryDto {
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

  @ApiPropertyOptional({ enum: ContainerMovementType })
  @IsOptional()
  @IsEnum(ContainerMovementType, { message: "El tipo de movimiento no es válido" })
  type?: ContainerMovementType;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID("4", { message: "El tipo de envase debe ser un identificador válido" })
  containerTypeId?: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID("4", { message: "La locación debe ser un identificador válido" })
  locationId?: string;

  @ApiPropertyOptional({ example: "2026-08-01", description: "Desde (inclusive, America/Lima)" })
  @IsOptional()
  @IsString({ message: `La fecha desde ${BUSINESS_DATE_MESSAGE}` })
  @Matches(BUSINESS_DATE_PATTERN, { message: `La fecha desde ${BUSINESS_DATE_MESSAGE}` })
  dateFrom?: string;

  @ApiPropertyOptional({ example: "2026-08-31", description: "Hasta (inclusive, America/Lima)" })
  @IsOptional()
  @IsString({ message: `La fecha hasta ${BUSINESS_DATE_MESSAGE}` })
  @Matches(BUSINESS_DATE_PATTERN, { message: `La fecha hasta ${BUSINESS_DATE_MESSAGE}` })
  dateTo?: string;
}
