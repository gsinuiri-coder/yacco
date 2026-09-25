import { ApiProperty } from "@nestjs/swagger";
import { IsString, Matches } from "class-validator";
import { MONEY_MESSAGE, MONEY_PATTERN } from "../../customers/dto/create-customer.dto.js";

/**
 * Only the list price, on purpose. The seeded prices were placeholders
 * (backlog «Precios de lista del catálogo de productos») and the office had
 * no way to set the real ones but a hand-written UPDATE. Name, type and
 * container type stay out: they are copied onto every order line and sale
 * (`OrderItem`/`SaleItem`), and renaming one is a catalog decision nobody has
 * asked for yet.
 *
 * A new price only applies from now on: order lines and sales keep the
 * `unitPrice` they were written with, and a customer's agreed price
 * (`CustomerPrice`) still wins over the list price.
 */
export class UpdateProductDto {
  @ApiProperty({ type: String, example: "8.00", description: "Precio de lista en soles (S/)" })
  @IsString({ message: `El precio de lista ${MONEY_MESSAGE}` })
  @Matches(MONEY_PATTERN, { message: `El precio de lista ${MONEY_MESSAGE}` })
  listPrice!: string;
}
