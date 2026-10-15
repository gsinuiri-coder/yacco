import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ContainerTypeQuantityDto, ReportNamedDto } from "./report-response.dto.js";

export class PlantStockRowDto {
  @ApiProperty({ type: ReportNamedDto })
  containerType!: ReportNamedDto;

  @ApiProperty({ example: 40, description: "Vacíos en planta; negativo si faltan ingresos" })
  empty!: number;

  @ApiProperty({ example: 25, description: "Llenos en planta" })
  full!: number;
}

export class PendingPaymentsDto {
  @ApiProperty({ example: 3 })
  count!: number;

  @ApiProperty({ example: "45.00" })
  amount!: string;
}

export class MaquilaPendingDto {
  @ApiProperty({ example: 12, description: "Bidones de clientes en planta, sin llenar" })
  emptyToFill!: number;

  @ApiProperty({ example: 4, description: "Bidones de clientes llenos, por devolver" })
  fullToReturn!: number;
}

/**
 * El Panel de quien pide, según sus roles. Cada campo viaja solo si alguno
 * de sus roles lo ve; lo que dos roles comparten viaja una vez. Los montos
 * en S/ son solo del administrador y del vendedor.
 */
export class RoleDashboardDto {
  @ApiProperty({ example: "2026-10-14", description: "El día de Lima del resumen" })
  today!: string;

  @ApiPropertyOptional({ example: "320.50", description: "Administrador: ventas del día" })
  salesToday?: string;

  @ApiPropertyOptional({
    example: "210.00",
    description: "Administrador: cobros confirmados del día",
  })
  paymentsToday?: string;

  @ApiPropertyOptional({ example: "1520.00", description: "Administrador: deuda total" })
  totalDebt?: string;

  @ApiPropertyOptional({ example: 2, description: "Administrador y vendedor" })
  routesInProgress?: number;

  @ApiPropertyOptional({ example: 18, description: "Vendedor: pedidos para hoy, sin anulados" })
  ordersToday?: number;

  @ApiPropertyOptional({
    example: 3,
    description: "Vendedor: pedidos no entregados sin reprogramar",
  })
  undeliveredOrders?: number;

  @ApiPropertyOptional({ type: PendingPaymentsDto, description: "Vendedor" })
  pendingPayments?: PendingPaymentsDto;

  @ApiPropertyOptional({ type: [ContainerTypeQuantityDto], description: "Supervisor de planta" })
  producedToday?: ContainerTypeQuantityDto[];

  @ApiPropertyOptional({ type: [PlantStockRowDto], description: "Supervisor de planta" })
  plantStock?: PlantStockRowDto[];

  @ApiPropertyOptional({ type: MaquilaPendingDto, description: "Supervisor de planta" })
  maquilaPending?: MaquilaPendingDto;

  @ApiPropertyOptional({
    type: [ContainerTypeQuantityDto],
    description: "Operador de planta: solo sus llenadas de hoy",
  })
  myFillingsToday?: ContainerTypeQuantityDto[];

  @ApiPropertyOptional({
    type: [ContainerTypeQuantityDto],
    description: "Operador de planta: vacíos para llenar (no viaja si ya va el stock de planta)",
  })
  emptyToFill?: ContainerTypeQuantityDto[];
}
