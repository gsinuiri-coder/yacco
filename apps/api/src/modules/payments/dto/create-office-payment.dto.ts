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

  @ApiPropertyOptional({
    format: "uuid",
    description:
      "Clave de idempotencia (UUID v4) generada por quien llama, para que un reintento de " +
      "red sobre este mismo POST nunca duplique el cobro. Sin ella, el comportamiento es el " +
      "de siempre: cada POST crea un pago nuevo. Con ella: la primera vez crea el pago y " +
      "responde 201; un reintento con la MISMA clave responde 200 con ese pago tal como está " +
      "hoy en la base (no lo reconstruye del request), aunque alguien ya lo haya confirmado o " +
      "rechazado entre medio; y si la clave ya se usó para otro cliente o con otro monto, " +
      "responde 409 — eso es un error de quien llama, no un reintento legítimo.",
  })
  @IsOptional()
  @IsUUID("4", { message: "La clave de idempotencia debe ser un UUID v4" })
  idempotencyKey?: string;
}
