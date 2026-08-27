import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, IsUUID, Matches } from "class-validator";
import { MONEY_MESSAGE, MONEY_PATTERN } from "../../customers/dto/create-customer.dto.js";

export class CreateCustomerPriceDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID("4", { message: "El producto debe ser un identificador válido" })
  productId!: string;

  // Absent (or omitted): the customer-wide price. Present: an override that
  // applies only to that one branch — see CustomerPricesService's precedence.
  @ApiPropertyOptional({ format: "uuid", nullable: true })
  @IsOptional()
  @IsUUID("4", { message: "La ubicación debe ser un identificador válido" })
  locationId?: string;

  @ApiProperty({ type: String, example: "12.50", description: "Monto en soles (S/)" })
  @IsString({ message: `El precio ${MONEY_MESSAGE}` })
  @Matches(MONEY_PATTERN, { message: `El precio ${MONEY_MESSAGE}` })
  price!: string;
}
