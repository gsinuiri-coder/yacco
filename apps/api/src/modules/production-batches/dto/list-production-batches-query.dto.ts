import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, Min } from "class-validator";
import { BUSINESS_DATE_MESSAGE, BUSINESS_DATE_PATTERN } from "../../orders/dto/create-order.dto.js";

/**
 * Los query params llegan como texto, así que un booleano necesita un
 * transform explícito — `Boolean("false")` es `true`. Cualquier otra cosa
 * pasa intacta para que @IsBoolean la reporte. Mismo helper que
 * ListUsersQueryDto y ListOrdersQueryDto, copiado en vez de importado: tres
 * filtros sin relación compartiendo uno los acoplaría sin motivo.
 */
function toOptionalBoolean({ value }: { value: unknown }): unknown {
  if (value === "true" || value === true) return true;
  if (value === "false" || value === false) return false;
  return value;
}

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

  /**
   * Sin valor por defecto: la pantalla de producción es un historial y tiene
   * que seguir mostrando los lotes ya consumidos. Solo la pantalla de carga
   * de ruta pide `withStock=true`, y lo necesita porque el listado va de la
   * fecha más antigua a la más nueva (que es el orden FIFO en el que se
   * consume): sin el filtro, la primera página serían los lotes más viejos,
   * que son justamente los que ya no tienen nada.
   */
  @ApiPropertyOptional({
    description: "true: solo lotes con al menos una línea con unidades disponibles",
  })
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean({ message: "El filtro de stock debe ser verdadero o falso" })
  withStock?: boolean;
}
