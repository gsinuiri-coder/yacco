import { ApiProperty } from "@nestjs/swagger";
import { IsDate, IsString, IsUUID, Matches } from "class-validator";
import { MONEY_MESSAGE, MONEY_PATTERN } from "../../customers/dto/create-customer.dto.js";

/**
 * Input to `SalesService.createOpeningCharge` — there is no controller for
 * this module (see the service's own doc comment for why), so nothing ever
 * runs this through Nest's `ValidationPipe`. The decorators here document
 * the shape and are ready for whenever a trusted caller (the roster loader)
 * validates it explicitly; the service still re-checks amount and date
 * itself rather than trusting them.
 */
export class CreateOpeningChargeDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID("4", { message: "El cliente debe ser un identificador válido" })
  customerId!: string;

  @ApiProperty({ type: String, example: "150.00", description: "Monto en soles (S/)" })
  @IsString({ message: `El monto ${MONEY_MESSAGE}` })
  @Matches(MONEY_PATTERN, { message: `El monto ${MONEY_MESSAGE}` })
  amount!: string;

  /**
   * An instant (timestamptz), not a business date — same as `occurredAt` on
   * `ContainerMovementsService.createWithinTransaction`. The caller resolves
   * its own calendar date to an instant; this service does no timezone
   * conversion.
   */
  @ApiProperty({ description: "Instante de la venta heredada del cuaderno" })
  @IsDate({ message: "La fecha de la venta debe ser una fecha válida" })
  soldAt!: Date;
}
