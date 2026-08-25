import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { IsBoolean, IsDateString, IsInt, IsOptional, IsUUID, Max, Min } from "class-validator";
import {
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
  MAX_LIMIT,
} from "../../customers/dto/list-customers-query.dto.js";

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

/**
 * Same page/limit contract as the customer roster (~500 locations; never
 * the whole list in one call). The filters are the four ways the owner
 * slices the audit work list — see ContainerBalancesService for each.
 */
export class ListContainerBalancesQueryDto {
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

  @ApiPropertyOptional({ format: "uuid", description: "Solo ubicaciones de clientes de esta zona" })
  @IsOptional()
  @IsUUID("4", { message: "La zona debe ser un identificador válido" })
  zoneId?: string;

  @ApiPropertyOptional({ description: "Solo ubicaciones que nunca se han contado" })
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean({ message: "El filtro de no contados debe ser verdadero o falso" })
  uncountedOnly?: boolean;

  /**
   * An instant (ISO-8601, timestamptz), not a business date: counts carry
   * `countedAt` as an instant, and this compares against it directly.
   */
  @ApiPropertyOptional({
    description:
      "Solo ubicaciones contadas alguna vez pero cuyo conteo más reciente es anterior a este instante (ISO-8601)",
  })
  @IsOptional()
  @IsDateString({}, { message: "La fecha de conteo debe ser una fecha válida (ISO-8601)" })
  countedBefore?: string;

  @ApiPropertyOptional({
    description: "Solo ubicaciones con algún tipo de envase en saldo negativo",
  })
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean({ message: "El filtro de discrepancias debe ser verdadero o falso" })
  withDiscrepancies?: boolean;
}
