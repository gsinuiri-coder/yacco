import { ApiProperty } from "@nestjs/swagger";
import { CustomerPriceProductDto } from "./customer-price-response.dto.js";

/**
 * Not a Prisma enum: nothing is stored with this value, it is only computed
 * at query time to tell the UI whether a price is agreed or the catalog's.
 */
export enum PriceSource {
  LOCATION = "LOCATION",
  CUSTOMER = "CUSTOMER",
  LIST = "LIST",
}

export class EffectivePriceResponseDto {
  @ApiProperty({ type: CustomerPriceProductDto })
  product!: CustomerPriceProductDto;

  /** 2-decimal string: a NUMERIC(10,2) never round-trips through a JSON number. */
  @ApiProperty({ type: String, example: "12.50" })
  price!: string;

  @ApiProperty({ enum: PriceSource })
  source!: PriceSource;
}
