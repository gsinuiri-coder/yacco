import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/** Minimum the office needs to recognise the product without a second call. */
export class CustomerPriceProductDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;
}

/** Minimum the office needs to recognise the location without a second call. */
export class CustomerPriceLocationDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;
}

export class CustomerPriceResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ type: CustomerPriceProductDto })
  product!: CustomerPriceProductDto;

  /** Null: this price applies to the customer as a whole, at every location. */
  @ApiPropertyOptional({ type: CustomerPriceLocationDto, nullable: true })
  location!: CustomerPriceLocationDto | null;

  /** 2-decimal string: a NUMERIC(10,2) never round-trips through a JSON number. */
  @ApiProperty({ type: String, example: "12.50" })
  price!: string;
}
