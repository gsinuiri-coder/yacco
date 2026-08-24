import { ApiProperty } from "@nestjs/swagger";
import { IsDate, IsString, IsUUID, Matches } from "class-validator";
import { MONEY_MESSAGE, MONEY_PATTERN } from "../../customers/dto/create-customer.dto.js";

/**
 * Input to `SalesService.createOpeningCredit`. Same story as
 * `CreateOpeningChargeDto`: no controller runs these decorators today, they
 * document the shape for later.
 */
export class CreateOpeningCreditDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID("4", { message: "El cliente debe ser un identificador válido" })
  customerId!: string;

  /**
   * For an opening credit this is informative at best, not trustworthy: the
   * money came in before the system existed, so nobody can say for certain
   * it moved through this exact method. The loader passes whatever the
   * plant owner indicates. `isOpeningBalance` is what actually matters —
   * this field never drives any behavior.
   */
  @ApiProperty({ format: "uuid" })
  @IsUUID("4", { message: "El método de pago debe ser un identificador válido" })
  paymentMethodId!: string;

  @ApiProperty({ type: String, example: "150.00", description: "Monto en soles (S/)" })
  @IsString({ message: `El monto ${MONEY_MESSAGE}` })
  @Matches(MONEY_PATTERN, { message: `El monto ${MONEY_MESSAGE}` })
  amount!: string;

  /** An instant (timestamptz), not a business date — same reasoning as `soldAt`. */
  @ApiProperty({ description: "Instante del abono heredado del cuaderno" })
  @IsDate({ message: "La fecha del pago debe ser una fecha válida" })
  paidAt!: Date;
}
