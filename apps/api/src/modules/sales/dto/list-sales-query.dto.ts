import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min } from "class-validator";
import {
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
  MAX_LIMIT,
} from "../../customers/dto/list-customers-query.dto.js";
import { BUSINESS_DATE_MESSAGE, BUSINESS_DATE_PATTERN } from "../../orders/dto/create-order.dto.js";

/** Filtros de la pantalla Ventas. Las fechas son días de negocio de Lima. */
export class ListSalesQueryDto {
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

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID("4", { message: "El cliente debe ser un identificador válido" })
  customerId?: string;

  @ApiPropertyOptional({ example: "2026-10-15", description: "Día de Lima desde (inclusive)" })
  @IsOptional()
  @IsString({ message: `La fecha desde ${BUSINESS_DATE_MESSAGE}` })
  @Matches(BUSINESS_DATE_PATTERN, { message: `La fecha desde ${BUSINESS_DATE_MESSAGE}` })
  soldFrom?: string;

  @ApiPropertyOptional({ example: "2026-10-15", description: "Día de Lima hasta (inclusive)" })
  @IsOptional()
  @IsString({ message: `La fecha hasta ${BUSINESS_DATE_MESSAGE}` })
  @Matches(BUSINESS_DATE_PATTERN, { message: `La fecha hasta ${BUSINESS_DATE_MESSAGE}` })
  soldTo?: string;
}
