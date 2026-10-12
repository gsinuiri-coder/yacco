import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { AccessoryMovementType } from "@prisma/client";

export class AccessorySummaryResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "Dispensador de mesa" })
  name!: string;

  @ApiProperty({ example: "35.00" })
  listPrice!: string;

  @ApiProperty({ example: true })
  active!: boolean;

  @ApiProperty({ example: 10, description: "Stock físico disponible en planta" })
  stock!: number;

  @ApiProperty({ example: 4, description: "Total prestado en clientes" })
  totalBorrowed!: number;
}

export class AccessoryMovementResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "uuid" })
  productId!: string;

  @ApiProperty({ example: "Dispensador de mesa" })
  productName!: string;

  @ApiProperty({ enum: AccessoryMovementType })
  type!: AccessoryMovementType;

  @ApiProperty({ example: 2 })
  quantity!: number;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  locationId!: string | null;

  @ApiPropertyOptional({ example: "Sede Principal", nullable: true })
  locationName!: string | null;

  @ApiPropertyOptional({ example: "Empresa ABC S.A.C.", nullable: true })
  customerName!: string | null;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  saleId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  reason!: string | null;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  reversesMovementId!: string | null;

  @ApiProperty({ format: "uuid" })
  recordedById!: string;

  @ApiProperty({ example: "Admin" })
  recordedByName!: string;

  @ApiProperty({ format: "date-time" })
  occurredAt!: Date;

  @ApiProperty({ format: "date-time" })
  createdAt!: Date;
}

export class PaginatedAccessoryMovementsDto {
  @ApiProperty({ type: AccessoryMovementResponseDto, isArray: true })
  data!: AccessoryMovementResponseDto[];

  @ApiProperty({ example: 50 })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 3 })
  totalPages!: number;
}

export class CustomerAccessoryBalanceResponseDto {
  @ApiProperty({ format: "uuid" })
  locationId!: string;

  @ApiProperty({ format: "uuid" })
  productId!: string;

  @ApiProperty({ example: "Dispensador de mesa" })
  productName!: string;

  @ApiProperty({ example: 3 })
  quantity!: number;

  @ApiProperty({ example: "35.00" })
  listPrice!: string;

  @ApiPropertyOptional({ example: "30.00", nullable: true })
  agreedPrice!: string | null;
}

export class BorrowedAccessoryResponseDto {
  @ApiProperty({ format: "uuid" })
  customerId!: string;

  @ApiProperty({ example: "Empresa ABC S.A.C." })
  customerName!: string;

  @ApiProperty({ format: "uuid" })
  locationId!: string;

  @ApiProperty({ example: "Sede Principal" })
  locationName!: string;

  @ApiProperty({ format: "uuid" })
  productId!: string;

  @ApiProperty({ example: "Dispensador de mesa" })
  productName!: string;

  @ApiProperty({ example: 3 })
  quantity!: number;

  @ApiProperty({ format: "date-time" })
  lastMovementAt!: Date;
}

export class AccessoryStockDiscrepancyDto {
  @ApiProperty({ format: "uuid" })
  productId!: string;

  @ApiProperty()
  productName!: string;

  @ApiProperty()
  materializedStock!: number;

  @ApiProperty()
  ledgerStock!: number;

  @ApiProperty()
  difference!: number;
}

export class CustomerAccessoryBalanceDiscrepancyDto {
  @ApiProperty({ format: "uuid" })
  locationId!: string;

  @ApiProperty()
  locationName!: string;

  @ApiProperty({ format: "uuid" })
  productId!: string;

  @ApiProperty()
  productName!: string;

  @ApiProperty()
  materializedBalance!: number;

  @ApiProperty()
  ledgerBalance!: number;

  @ApiProperty()
  difference!: number;
}

export class AccessoryReconciliationResponseDto {
  @ApiProperty({ type: AccessoryStockDiscrepancyDto, isArray: true })
  stockDiscrepancies!: AccessoryStockDiscrepancyDto[];

  @ApiProperty({ type: CustomerAccessoryBalanceDiscrepancyDto, isArray: true })
  customerBalanceDiscrepancies!: CustomerAccessoryBalanceDiscrepancyDto[];

  @ApiProperty({ example: true })
  isBalanced!: boolean;
}

export class AccessoryCountResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "uuid" })
  productId!: string;

  @ApiProperty({ example: 10 })
  expectedQty!: number;

  @ApiProperty({ example: 8 })
  countedQty!: number;

  @ApiPropertyOptional({ nullable: true })
  reason!: string | null;

  @ApiProperty({ format: "uuid" })
  recordedById!: string;

  @ApiProperty({ format: "date-time" })
  createdAt!: Date;
}
