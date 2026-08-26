import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsDateString, IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from "class-validator";
import { PaymentStatus } from "@prisma/client";
import {
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
  MAX_LIMIT,
} from "../../customers/dto/list-customers-query.dto.js";

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
}
