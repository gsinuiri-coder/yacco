import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { PaymentStatus } from "@prisma/client";

export class AccountStatementCustomerDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: String, example: "40.00" })
  debtBalance!: string;
}

/**
 * One row of the interleaved ledger. `saleId`/`locationName` are set only on
 * a CHARGE; `paymentId`/`paymentMethodName`/`status` only on a PAYMENT —
 * `isOpeningBalance` applies to both. A flat, nullable-cross-fields shape
 * (rather than two DTO classes) because Swagger has no clean way to express
 * a discriminated union, and this mirrors how PaymentRowDto already handles
 * confirm/reject's mutually-exclusive optional fields.
 */
export class AccountStatementEntryDto {
  @ApiProperty({ format: "date-time" })
  date!: Date;

  @ApiProperty({ enum: ["CHARGE", "PAYMENT"] })
  type!: "CHARGE" | "PAYMENT";

  @ApiProperty({ type: String, example: "24.99" })
  amount!: string;

  /**
   * The balance right after this entry is applied — a CONFIRMED payment
   * decreases it, a charge increases it, and a PENDING/REJECTED payment or
   * any voided row leaves it exactly where it was (see
   * CustomersService.getAccountStatement).
   */
  @ApiProperty({ type: String, example: "64.99" })
  runningBalance!: string;

  @ApiProperty()
  isOpeningBalance!: boolean;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  saleId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  locationName!: string | null;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  paymentId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  paymentMethodName!: string | null;

  @ApiPropertyOptional({ enum: PaymentStatus, nullable: true })
  status!: PaymentStatus | null;

  /**
   * Cuándo se anuló este cargo o este cobro; null si sigue en pie. Anulado,
   * `amount` sigue siendo el monto original y `runningBalance` no se mueve:
   * la fila está para verse, no para contarse.
   */
  @ApiPropertyOptional({ format: "date-time", nullable: true })
  voidedAt!: Date | null;
}

export class AccountStatementResponseDto {
  @ApiProperty({ type: AccountStatementCustomerDto })
  customer!: AccountStatementCustomerDto;

  /** The balance the window starts with; "0.00" when `from` is omitted. */
  @ApiProperty({ type: String, example: "0.00" })
  openingBalance!: string;

  @ApiProperty({ type: AccountStatementEntryDto, isArray: true })
  entries!: AccountStatementEntryDto[];

  @ApiProperty({ type: String, example: "40.00" })
  closingBalance!: string;
}
