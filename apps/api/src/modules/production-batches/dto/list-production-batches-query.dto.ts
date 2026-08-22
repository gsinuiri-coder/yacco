import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Matches, Max, Min } from "class-validator";
import { BUSINESS_DATE_MESSAGE, BUSINESS_DATE_PATTERN } from "../../orders/dto/create-order.dto.js";

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

export class ListProductionBatchesQueryDto {
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

  @ApiPropertyOptional({ example: "2026-08-01", description: "Desde (inclusive)" })
  @IsOptional()
  @IsString({ message: `La fecha desde ${BUSINESS_DATE_MESSAGE}` })
  @Matches(BUSINESS_DATE_PATTERN, { message: `La fecha desde ${BUSINESS_DATE_MESSAGE}` })
  dateFrom?: string;

  @ApiPropertyOptional({ example: "2026-08-31", description: "Hasta (inclusive)" })
  @IsOptional()
  @IsString({ message: `La fecha hasta ${BUSINESS_DATE_MESSAGE}` })
  @Matches(BUSINESS_DATE_PATTERN, { message: `La fecha hasta ${BUSINESS_DATE_MESSAGE}` })
  dateTo?: string;
}
