import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class ContainerReconciliationDiscrepancyDto {
  /**
   * Null means this discrepancy's location_id doesn't resolve to any
   * customer_locations row — including a WITH_CUSTOMER movement recorded
   * with a NULL location_id, which the public route can never produce but a
   * bypass of it could. That IS the finding, not a formatting gap: this
   * routine reports the orphan rather than hiding it behind a join that
   * would silently drop the row.
   */
  @ApiPropertyOptional({ format: "uuid", nullable: true })
  locationId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  locationName!: string | null;

  @ApiProperty({ format: "uuid" })
  containerTypeId!: string;

  /** Null means container_type_id doesn't resolve to any container_types row — same reasoning as locationName. */
  @ApiPropertyOptional({ nullable: true })
  containerTypeName!: string | null;

  /** Reconstructed straight from container_movements — never read from the materialized balance. */
  @ApiProperty({ example: 8 })
  ledgerQuantity!: number;

  /** What customer_container_balances currently holds for this pair. */
  @ApiProperty({ example: 5 })
  materializedQuantity!: number;

  /** ledgerQuantity - materializedQuantity: positive means the balance undercounts, negative means it overcounts. */
  @ApiProperty({ example: 3 })
  difference!: number;
}

export class ContainerReconciliationResponseDto {
  @ApiProperty()
  checkedAt!: Date;

  @ApiProperty({ example: 0 })
  discrepancyCount!: number;

  @ApiProperty({ type: ContainerReconciliationDiscrepancyDto, isArray: true })
  discrepancies!: ContainerReconciliationDiscrepancyDto[];
}
