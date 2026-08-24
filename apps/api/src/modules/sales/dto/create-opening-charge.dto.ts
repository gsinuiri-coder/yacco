import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsDate, IsOptional, IsString, IsUUID, Matches, MinLength } from "class-validator";
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

  /**
   * The amount is the OUTSTANDING BALANCE of that delivery, not its original
   * price: the source has lines with partial payments already applied, where
   * the figure is not quantity times price. Nothing here tries to reconcile
   * it against anything, on purpose.
   */
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

  /**
   * Reference to the record in the system of origin (the loader's source).
   * Unique when present (sales_external_id_key): a second run of the loader
   * is rejected on the charge it already created instead of creating it
   * again. Optional because nothing else that registers a sale has one.
   */
  @ApiPropertyOptional({ description: "Referencia al registro del sistema de origen" })
  @IsOptional()
  @IsString({ message: "La referencia externa debe ser un texto" })
  @MinLength(1, { message: "La referencia externa no puede estar vacía" })
  externalId?: string;
}
