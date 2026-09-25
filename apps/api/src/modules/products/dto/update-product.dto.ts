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
 * A new price applies to what is DELIVERED from now on: sales already
 * written keep their `unitPrice`, but a pending order is priced at delivery
 * (SalesService resolves location price, customer price, then list price at
 * that moment), so it gets the new one — supuesto 17. A customer's agreed
 * price (`CustomerPrice`) still wins over the list price. Zero is refused
 * in ProductsService.update.
 */
export class UpdateProductDto {
  @ApiProperty({ type: String, example: "8.00", description: "Precio de lista en soles (S/)" })
  @IsString({ message: `El precio de lista ${MONEY_MESSAGE}` })
  @Matches(MONEY_PATTERN, { message: `El precio de lista ${MONEY_MESSAGE}` })
  listPrice!: string;
}
