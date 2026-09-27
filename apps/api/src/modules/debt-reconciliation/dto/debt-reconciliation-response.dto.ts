import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class DebtReconciliationDiscrepancyDto {
  /**
   * Null when the ledger has money for a customer that does not resolve: a
   * sale whose location points to no `customer_locations` row. That IS the
   * finding; the LEFT JOIN keeps it instead of dropping it.
   */
  @ApiPropertyOptional({ format: "uuid", nullable: true })
  customerId!: string | null;

  /** Null when `customerId` resolves to no customer — same reasoning. */
  @ApiPropertyOptional({ nullable: true })
  customerName!: string | null;

  /** Rebuilt from `sales` and `payments`, never read from `debt_balance`. 2-decimal string. */
  @ApiProperty({ example: "40.00" })
  ledgerBalance!: string;

  /** What `customers.debt_balance` holds today. 2-decimal string. */
  @ApiProperty({ example: "32.00" })
  materializedBalance!: string;

  /** ledgerBalance - materializedBalance: positive means the balance undercounts the debt. */
  @ApiProperty({ example: "8.00" })
  difference!: string;
}

export class DebtReconciliationResponseDto {
  @ApiProperty()
  checkedAt!: Date;

  @ApiProperty({ example: 0 })
  discrepancyCount!: number;

  @ApiProperty({ type: DebtReconciliationDiscrepancyDto, isArray: true })
  discrepancies!: DebtReconciliationDiscrepancyDto[];
}
