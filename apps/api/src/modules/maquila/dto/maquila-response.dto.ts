import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { MaquilaMovementType } from "@prisma/client";

export class MaquilaBalanceResponseDto {
  @ApiProperty({ format: "uuid" })
  customerId!: string;

  @ApiProperty({ format: "uuid" })
  containerTypeId!: string;

  @ApiProperty()
  containerTypeName!: string;

  @ApiProperty({ example: 4 })
  emptyAtPlant!: number;

  @ApiProperty({ example: 6 })
  fullToReturn!: number;

  @ApiPropertyOptional({ example: "2.50" })
  unitPrice!: string | null;

  @ApiPropertyOptional({ format: "uuid" })
  productId!: string | null;
}

export class MaquilaCustomerSummaryResponseDto {
  @ApiProperty({ format: "uuid" })
  customerId!: string;

  @ApiProperty()
  customerName!: string;

  @ApiProperty({ example: 4 })
  emptyAtPlantTotal!: number;

  @ApiProperty({ example: 6 })
  fullToReturnTotal!: number;

  @ApiProperty({ type: [MaquilaBalanceResponseDto] })
  balances!: MaquilaBalanceResponseDto[];
}

export class MaquilaMovementResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "uuid" })
  customerId!: string;

  @ApiProperty()
  customerName!: string;

  @ApiProperty({ format: "uuid" })
  containerTypeId!: string;

  @ApiProperty()
  containerTypeName!: string;

  @ApiProperty({ enum: MaquilaMovementType })
  type!: MaquilaMovementType;

  @ApiProperty({ example: 10 })
  quantity!: number;

  @ApiPropertyOptional({ format: "uuid" })
  saleId!: string | null;

  @ApiPropertyOptional({ example: "25.00" })
  saleTotal!: string | null;

  @ApiPropertyOptional({ format: "uuid" })
  reversesMovementId!: string | null;

  @ApiPropertyOptional()
  reason!: string | null;

  @ApiProperty({ format: "uuid" })
  recordedById!: string;

  @ApiProperty()
  recordedByName!: string;

  @ApiProperty()
  occurredAt!: string;

  @ApiProperty()
  createdAt!: string;
}

export class PaginatedMaquilaMovementsResponseDto {
  @ApiProperty({ type: [MaquilaMovementResponseDto] })
  data!: MaquilaMovementResponseDto[];

  @ApiProperty({ example: 100 })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 5 })
  totalPages!: number;
}

export class MaquilaDiscrepancyResponseDto {
  @ApiProperty({ format: "uuid" })
  customerId!: string;

  @ApiProperty()
  customerName!: string;

  @ApiProperty({ format: "uuid" })
  containerTypeId!: string;

  @ApiProperty()
  containerTypeName!: string;

  @ApiProperty()
  bookEmpty!: number;

  @ApiProperty()
  bookFull!: number;

  @ApiProperty()
  ledgerEmpty!: number;

  @ApiProperty()
  ledgerFull!: number;
}

export class MaquilaReconciliationResponseDto {
  @ApiProperty()
  isBalanced!: boolean;

  @ApiProperty({ type: [MaquilaDiscrepancyResponseDto] })
  discrepancies!: MaquilaDiscrepancyResponseDto[];
}
