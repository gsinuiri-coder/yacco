import { ApiProperty } from "@nestjs/swagger";
import { OrderStatus } from "@prisma/client";

/** Minimum the office needs to recognise the customer without a second call. */
export class OrderCustomerDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  phone!: string;
}

export class OrderProductDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;
}

export class OrderItemResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "uuid" })
  productId!: string;

  @ApiProperty({ type: OrderProductDto })
  product!: OrderProductDto;

  @ApiProperty({ example: 3 })
  quantity!: number;

  /** 2-decimal string: a NUMERIC(10,2) never round-trips through a JSON number. */
  @ApiProperty({ type: String, example: "12.50" })
  unitPrice!: string;
}

export class OrderResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "uuid" })
  customerId!: string;

  @ApiProperty({ type: OrderCustomerDto })
  customer!: OrderCustomerDto;

  /**
   * Calendar day in America/Lima, as `YYYY-MM-DD`. It is a DATE column, not a
   * timestamp, so it is never serialized as an instant — that would drag a
   * timezone into a business day and shift it by one at the edges.
   */
  @ApiProperty({ type: String, example: "2026-08-25" })
  deliveryDate!: string;

  @ApiProperty({ enum: OrderStatus })
  status!: OrderStatus;

  @ApiProperty({ format: "uuid" })
  createdById!: string;

  @ApiProperty({ format: "date-time" })
  createdAt!: Date;

  @ApiProperty({ type: OrderItemResponseDto, isArray: true })
  items!: OrderItemResponseDto[];
}

export class PaginatedOrdersDto {
  @ApiProperty({ type: OrderResponseDto, isArray: true })
  data!: OrderResponseDto[];

  @ApiProperty({ description: "Total de pedidos que cumplen el filtro" })
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty({ description: "Número total de páginas para el filtro actual" })
  totalPages!: number;
}
