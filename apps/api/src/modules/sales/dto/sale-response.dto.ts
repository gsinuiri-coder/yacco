import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export enum SaleOrigin {
  ROUTE = "ROUTE",
  OFFICE = "OFFICE",
  MAQUILA = "MAQUILA",
  ACCESSORY = "ACCESSORY",
}

export class SaleCustomerDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() name!: string;
}

export class SaleLocationDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() name!: string;
}

export class SaleProductDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() name!: string;
}

export class SaleItemRowDto {
  @ApiProperty({ type: SaleProductDto }) product!: SaleProductDto;
  @ApiProperty() quantity!: number;
}

export class SaleRowDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "date-time" }) soldAt!: Date;
  @ApiProperty({ type: String, example: "35.00" }) total!: string;
  @ApiProperty({ type: SaleCustomerDto }) customer!: SaleCustomerDto;
  @ApiProperty({ type: SaleLocationDto }) location!: SaleLocationDto;
  @ApiProperty({ type: SaleItemRowDto, isArray: true }) items!: SaleItemRowDto[];
  @ApiProperty({ enum: SaleOrigin }) origin!: SaleOrigin;
  @ApiPropertyOptional({ format: "date-time", nullable: true }) voidedAt!: Date | null;
  @ApiPropertyOptional({ nullable: true }) voidReason!: string | null;
}

export class PaginatedSalesDto {
  @ApiProperty({ type: SaleRowDto, isArray: true }) data!: SaleRowDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() totalPages!: number;
  /** Suma del filtro completo, sin ventas anuladas; nunca solo la página. */
  @ApiProperty({ type: String, example: "1250.50" }) totalAmount!: string;
}
