import { ApiProperty } from "@nestjs/swagger";
import { IsString, Matches } from "class-validator";
import { MONEY_MESSAGE, MONEY_PATTERN } from "../../customers/dto/create-customer.dto.js";

/**
 * Only the price can change here. Re-pointing an existing agreement at a
 * different product or location would be a different agreement, not an
 * update to this one — delete and create instead.
 */
export class UpdateCustomerPriceDto {
  @ApiProperty({ type: String, example: "12.50", description: "Monto en soles (S/)" })
  @IsString({ message: `El precio ${MONEY_MESSAGE}` })
  @Matches(MONEY_PATTERN, { message: `El precio ${MONEY_MESSAGE}` })
  price!: string;
}
