import { ApiProperty } from "@nestjs/swagger";

export class ContainerReconciliationDiscrepancyDto {
  @ApiProperty({ format: "uuid" })
  locationId!: string;

  @ApiProperty()
  locationName!: string;

  @ApiProperty({ format: "uuid" })
  containerTypeId!: string;

  @ApiProperty()
  containerTypeName!: string;

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
