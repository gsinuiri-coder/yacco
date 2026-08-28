import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from "class-validator";
import { OrderStatus } from "@prisma/client";
import { BUSINESS_DATE_MESSAGE, BUSINESS_DATE_PATTERN } from "./create-order.dto.js";

/**
 * Los query params llegan como texto, así que un booleano necesita un
 * transform explícito — `Boolean("false")` es `true`. Cualquier otra cosa
 * pasa intacta para que @IsBoolean la reporte en vez de volverse false en
 * silencio. Copiado de ListUsersQueryDto en vez de importado: dos filtros sin
 * relación compartiendo un helper por cross-import los acoplaría sin motivo.
 */
function toOptionalBoolean({ value }: { value: unknown }): unknown {
  if (value === "true" || value === true) return true;
  if (value === "false" || value === false) return false;
  return value;
}

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
// Orders accumulate one row per customer per delivery day, so an uncapped
// page size would let a single call pull the whole history.
export const MAX_LIMIT = 100;

export class ListOrdersQueryDto {
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

  @ApiPropertyOptional({ enum: OrderStatus })
  @IsOptional()
  @IsEnum(OrderStatus, { message: "El estado no es un estado de pedido válido" })
  status?: OrderStatus;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID("4", { message: "El cliente debe ser un identificador válido" })
  customerId?: string;

  @ApiPropertyOptional({ example: "2026-08-01", description: "Desde (inclusive)" })
  @IsOptional()
  @IsString({ message: `La fecha desde ${BUSINESS_DATE_MESSAGE}` })
  @Matches(BUSINESS_DATE_PATTERN, { message: `La fecha desde ${BUSINESS_DATE_MESSAGE}` })
  deliveryDateFrom?: string;

  @ApiPropertyOptional({ example: "2026-08-31", description: "Hasta (inclusive)" })
  @IsOptional()
  @IsString({ message: `La fecha hasta ${BUSINESS_DATE_MESSAGE}` })
  @Matches(BUSINESS_DATE_PATTERN, { message: `La fecha hasta ${BUSINESS_DATE_MESSAGE}` })
  deliveryDateTo?: string;

  /**
   * Sin valor por defecto, a diferencia de `active` en ListUsersQueryDto: la
   * bandeja de pedidos de la oficina tiene que seguir mostrando TODOS los
   * pedidos, con parada o sin ella. Solo el selector de paradas de una ruta
   * pide `hasRouteStop=false`, y lo pide junto a `status=PENDING`: esas dos
   * condiciones juntas son exactamente lo que `RoutesService.addStop` acepta,
   * así que la lista que se ofrece y la que se acepta coinciden.
   */
  @ApiPropertyOptional({
    description:
      "false: solo pedidos sin parada asignada; true: solo los que ya están en una ruta. Omitido, no filtra",
  })
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean({ message: "El filtro de parada asignada debe ser verdadero o falso" })
  hasRouteStop?: boolean;
}
