import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from "class-validator";
import { PaymentStatus } from "@prisma/client";
import {
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
  MAX_LIMIT,
} from "../../customers/dto/list-customers-query.dto.js";

/**
 * Query params arrive as strings, so booleans need an explicit transform —
 * `Boolean("false")` is `true`. Anything other than "true"/"false" is left
 * untouched so @IsBoolean reports it instead of it silently becoming false.
 * Copied rather than imported — see ListPaymentMethodsQueryDto's own copy of
 * this same helper for why.
 */
function toOptionalBoolean({ value }: { value: unknown }): unknown {
  if (value === "true" || value === true) return true;
  if (value === "false" || value === false) return false;
  return value;
}

/**
 * `paidFrom`/`paidTo` are instants (ISO-8601), not business dates: `paidAt`
 * is a timestamptz, so this filters against it directly — unlike
 * `deliveryDate`/`routes.date`, there is no calendar-day parsing here.
 */
export class ListPaymentsQueryDto {
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

  @ApiPropertyOptional({ enum: PaymentStatus })
  @IsOptional()
  @IsEnum(PaymentStatus, { message: "El estado no es un estado de pago válido" })
  status?: PaymentStatus;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID("4", { message: "El método de pago debe ser un identificador válido" })
  paymentMethodId?: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID("4", { message: "El cliente debe ser un identificador válido" })
  customerId?: string;

  @ApiPropertyOptional({ description: "Instante ISO-8601: solo pagos cobrados desde aquí" })
  @IsOptional()
  @IsDateString({}, { message: "La fecha desde debe ser un instante válido (ISO-8601)" })
  paidFrom?: string;

  @ApiPropertyOptional({ description: "Instante ISO-8601: solo pagos cobrados hasta aquí" })
  @IsOptional()
  @IsDateString({}, { message: "La fecha hasta debe ser un instante válido (ISO-8601)" })
  paidTo?: string;

  /**
   * An opening credit is real debt on the account statement, but it's money
   * that moved before the system existed — showing it in a period's
   * collection list would mix it with cash actually received today. Default
   * false: whoever audits the day's cutoff has to ask for it explicitly.
   */
  @ApiPropertyOptional({
    default: false,
    description: "Incluye los abonos de apertura del padrón; por defecto se excluyen",
  })
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean({ message: "El filtro de aperturas debe ser verdadero o falso" })
  includeOpeningBalance?: boolean;
}
