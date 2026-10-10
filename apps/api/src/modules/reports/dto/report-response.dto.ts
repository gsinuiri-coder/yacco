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

  @ApiProperty({
    description:
      "Si el cargo que abrió la deuda actual es el saldo inicial del padrón: entonces `oldestChargeDate` es la fecha con que se cargó, no la de una venta hecha en el sistema",
  })
  openedByOpeningBalance!: boolean;
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

/**
 * Lo que la tarjeta «Puesta en marcha» del Panel necesita para saber qué le
 * falta a la planta antes de operar con datos reales. Son hechos, no textos:
 * el web decide qué ítem mostrar y con qué palabras.
 */
export class SetupChecklistDto {
  @ApiProperty({ type: [ReportNamedDto], description: "Zonas activas sin días de reparto" })
  zonesWithoutDeliveryDays!: ReportNamedDto[];

  @ApiProperty({ example: 2, description: "Usuarios activos con rol Chofer" })
  activeDrivers!: number;

  @ApiProperty({ example: 1, description: "Usuarios activos con rol Vendedor" })
  activeSellers!: number;

  @ApiProperty({
    example: 120,
    description: "Ubicaciones activas de clientes activos que nunca se contaron",
  })
  uncountedLocations!: number;

  @ApiProperty({ example: 35, description: "Locales activos sin latitud o longitud" })
  locationsWithoutCoordinates!: number;

  @ApiProperty({ example: 0, description: "Usuarios activos cuyo nombre empieza con PRUEBA" })
  activeTestUsers!: number;

  @ApiProperty({ example: 0, description: "Clientes activos cuyo nombre empieza con PRUEBA" })
  activeTestCustomers!: number;

  @ApiProperty({
    type: [ReportNamedDto],
    description: "Productos activos cuyo precio de lista nunca cambió desde la carga",
  })
  productsWithInitialListPrice!: ReportNamedDto[];
}
