import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
// The roster is ~500 customers and grows; an unbounded page size would let a
// single call pull the whole table, so `limit` is capped rather than optional.
export const MAX_LIMIT = 100;

/**
 * Query params arrive as strings, so booleans need an explicit transform —
 * `Boolean("false")` is `true`. Anything other than "true"/"false" is left
 * untouched so @IsBoolean reports it instead of it silently becoming false.
 */
function toOptionalBoolean({ value }: { value: unknown }): unknown {
  if (value === "true" || value === true) return true;
  if (value === "false" || value === false) return false;
  return value;
}

export class ListCustomersQueryDto {
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

  @ApiPropertyOptional({ description: "Busca coincidencias parciales en nombre o teléfono" })
  @IsOptional()
  @IsString()
  @MaxLength(160, { message: "La búsqueda no puede superar los 160 caracteres" })
  search?: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID("4", { message: "La zona debe ser un identificador válido" })
  zoneId?: string;

  @ApiPropertyOptional({ description: "Filtra por clientes activos o desactivados" })
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean({ message: "El filtro activo debe ser verdadero o falso" })
  active?: boolean;
}
