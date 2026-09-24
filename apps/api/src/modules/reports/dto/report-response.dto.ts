import { ApiProperty } from "@nestjs/swagger";

export class ReportNamedDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;
}

export class CustomerDebtRowDto {
  @ApiProperty({ type: ReportNamedDto })
  customer!: ReportNamedDto;

  @ApiProperty({ type: ReportNamedDto, nullable: true })
  zone!: ReportNamedDto | null;

  @ApiProperty({ example: "50.50", description: "Deuda en soles, reconstruida del libro" })
  debt!: string;

  @ApiProperty({
    example: "2026-09-03",
    description:
      "Día (Lima) del cargo más antiguo desde la última vez que el cliente estuvo al día",
  })
  oldestChargeDate!: string;
}

export class CustomerDebtsReportDto {
  @ApiProperty({ type: [CustomerDebtRowDto] })
  rows!: CustomerDebtRowDto[];

  @ApiProperty({ example: "69.75" })
  total!: string;
}

export class LoanedContainerRowDto {
  @ApiProperty({ type: ReportNamedDto })
  customer!: ReportNamedDto;

  @ApiProperty({ type: ReportNamedDto })
  containerType!: ReportNamedDto;

  @ApiProperty({ example: 5, description: "Puede ser negativo: devolvió más de lo registrado" })
  quantity!: number;
}

export class ContainerTypeQuantityDto {
  @ApiProperty({ type: ReportNamedDto })
  containerType!: ReportNamedDto;

  @ApiProperty({ example: 8 })
  quantity!: number;
}

export class LoanedContainersReportDto {
  @ApiProperty({ type: [LoanedContainerRowDto] })
  rows!: LoanedContainerRowDto[];

  @ApiProperty({ type: [ContainerTypeQuantityDto] })
  byType!: ContainerTypeQuantityDto[];

  @ApiProperty({ example: 12 })
  total!: number;
}

export class ProducedByTypeDto {
  @ApiProperty({ type: ReportNamedDto })
  containerType!: ReportNamedDto;

  @ApiProperty({ example: 13 })
  producedQty!: number;
}

export class ProductionReportBatchDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "LOTE-001" })
  code!: string;

  @ApiProperty({ example: "2026-07-01" })
  date!: string;

  @ApiProperty({ type: [ProducedByTypeDto] })
  items!: ProducedByTypeDto[];

  @ApiProperty({ example: 15 })
  total!: number;
}

export class ProductionReportDto {
  @ApiProperty({ type: [ProductionReportBatchDto] })
  batches!: ProductionReportBatchDto[];

  @ApiProperty({ type: [ProducedByTypeDto] })
  byType!: ProducedByTypeDto[];

  @ApiProperty({ example: 18 })
  total!: number;
}
