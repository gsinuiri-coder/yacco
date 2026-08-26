import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsDateString, IsOptional, IsString, IsUUID, Matches } from "class-validator";
import { MONEY_MESSAGE, MONEY_PATTERN } from "../../customers/dto/create-customer.dto.js";

/**
 * A collection made at the plant, or by transfer, outside a route (HU-18) —
 * never a driver's dispatch collection, which enters through
 * MarkRouteStopDto/SalesService instead. See PaymentsService.createOfficePayment
 * for why this always lands CONFIRMED regardless of the method's
 * requiresConfirmation.
 */
export class CreateOfficePaymentDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID("4", { message: "El cliente debe ser un identificador válido" })
  customerId!: string;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  @IsOptional()
  @IsUUID("4", { message: "La locación debe ser un identificador válido" })
  locationId?: string;

  @ApiProperty({ format: "uuid" })
  @IsUUID("4", { message: "El método de pago debe ser un identificador válido" })
  paymentMethodId!: string;

  @ApiProperty({ type: String, example: "50.00", description: "Monto en soles (S/)" })
  @IsString({ message: `El monto ${MONEY_MESSAGE}` })
  @Matches(MONEY_PATTERN, { message: `El monto ${MONEY_MESSAGE}` })
  amount!: string;

  @ApiPropertyOptional({
    description: "Instante ISO-8601 en que se cobró; por defecto el momento del registro",
  })
  @IsOptional()
  @IsDateString({}, { message: "La fecha del pago debe ser un instante válido (ISO-8601)" })
  paidAt?: string;
}
