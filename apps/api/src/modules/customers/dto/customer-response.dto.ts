import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class CustomerResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  phone!: string;

  @ApiProperty()
  address!: string;

  @ApiProperty()
  addressReference!: string;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  zoneId!: string | null;

  /**
   * Read-only. Serialized as a fixed 2-decimal string so a NUMERIC(10,2)
   * never round-trips through a JSON number (an IEEE-754 double).
   */
  @ApiPropertyOptional({ type: String, example: "150.00", nullable: true })
  creditLimit!: string | null;

  /**
   * Read-only ledger balance in soles: the office reads it here to know who
   * owes, but no route in this module writes it. It moves only through sales
   * and payments, in the same transaction as the row that caused the change.
   */
  @ApiProperty({ type: String, example: "0.00" })
  debtBalance!: string;

  @ApiProperty()
  active!: boolean;

  @ApiProperty({ format: "date-time" })
  createdAt!: Date;
}

export class PaginatedCustomersDto {
  @ApiProperty({ type: CustomerResponseDto, isArray: true })
  data!: CustomerResponseDto[];

  @ApiProperty({ description: "Total de clientes que cumplen el filtro" })
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty({ description: "Número total de páginas para el filtro actual" })
  totalPages!: number;
}
