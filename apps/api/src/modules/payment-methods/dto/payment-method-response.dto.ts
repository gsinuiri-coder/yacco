import { ApiProperty } from "@nestjs/swagger";

export class PaymentMethodResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  active!: boolean;

  /**
   * Lets the collection screen warn "this will stay pending until the
   * office confirms it" before the user registers the charge — without
   * this, the UI would have to hardcode which methods are wallets, exactly
   * what this column exists to avoid.
   */
  @ApiProperty()
  requiresConfirmation!: boolean;
}
