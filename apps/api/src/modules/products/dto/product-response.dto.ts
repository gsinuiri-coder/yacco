import { ApiProperty } from "@nestjs/swagger";
import { ProductType } from "@prisma/client";

/** Minimum the office needs to recognise the container type without a second call. */
export class ProductContainerTypeDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;
}

export class ProductResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: ProductType })
  type!: ProductType;

  @ApiProperty({ type: ProductContainerTypeDto })
  containerType!: ProductContainerTypeDto;

  /** 2-decimal string: a NUMERIC(10,2) never round-trips through a JSON number. */
  @ApiProperty({ type: String, example: "8.00" })
  listPrice!: string;

  @ApiProperty()
  active!: boolean;
}
