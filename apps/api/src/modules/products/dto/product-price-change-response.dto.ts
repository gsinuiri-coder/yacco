import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class ProductPriceChangeUserDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;
}

export class ProductPriceChangeResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  /** Null only when a future product's initial price is explicitly recorded. */
  @ApiPropertyOptional({ type: String, example: "8.00", nullable: true })
  previousPrice!: string | null;

  @ApiProperty({ type: String, example: "9.50" })
  newPrice!: string;

  @ApiProperty({ format: "date-time" })
  changedAt!: string;

  @ApiProperty({ type: ProductPriceChangeUserDto })
  changedBy!: ProductPriceChangeUserDto;
}
