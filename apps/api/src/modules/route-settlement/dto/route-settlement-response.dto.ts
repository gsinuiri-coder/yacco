import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/** Everything derivable from the ledger alone — no physical count involved. */
export class RouteSettlementExpectedDto {
  @ApiProperty({ description: "Suma de RouteLoad.quantity de la ruta" })
  fullOut!: number;

  @ApiProperty({ description: "Llenos entregados bajo canje (LOAN_DELIVERY)" })
  fullDelivered!: number;

  @ApiProperty({ description: "Llenos vendidos completos, salen de la flota (FULL_SALE)" })
  fullSold!: number;

  /**
   * Vacíos que el libro dice que se recogieron (EMPTY_PICKUP). Es el número
   * contra el que se cuenta al descargar el camión: sin él, la vista previa
   * pide un conteo físico sin decir con qué compararlo. No se persiste en
   * `route_settlements` —siempre es reconstruible del ledger— por la misma
   * razón por la que `differences` tampoco se guarda.
   */
  @ApiProperty({ description: "Vacíos recogidos según el libro (EMPTY_PICKUP)" })
  emptiesPickedUp!: number;

  @ApiProperty({ type: String, example: "320.00" })
  totalSold!: string;

  /** CONFIRMED + PENDING; un pago REJECTED nunca suma aquí. */
  @ApiProperty({ type: String, example: "280.00" })
  totalCollected!: string;

  @ApiProperty({
    type: String,
    example: "150.00",
    description: "CONFIRMED con requiresConfirmation: false",
  })
  totalCashCollected!: string;

  @ApiProperty({
    type: String,
    example: "130.00",
    description: "Pagos PENDING, todavía sin confirmar",
  })
  totalPendingConfirmation!: string;

  @ApiProperty({ type: String, example: "40.00" })
  totalOnCredit!: string;
}

/** The persisted row: what actually got liquidated, physical counts included. */
export class RouteSettlementDto {
  @ApiProperty({ format: "uuid" })
  routeId!: string;

  @ApiProperty()
  fullOut!: number;

  @ApiProperty()
  fullDelivered!: number;

  @ApiProperty()
  fullSold!: number;

  @ApiProperty({ description: "Contado físicamente al cierre" })
  fullReturned!: number;

  @ApiProperty({ description: "Contado físicamente al cierre" })
  emptiesCollected!: number;

  @ApiProperty({ type: String, example: "320.00" })
  totalSold!: string;

  @ApiProperty({ type: String, example: "280.00" })
  totalCollected!: string;

  @ApiProperty({ type: String, example: "150.00" })
  totalCashCollected!: string;

  @ApiProperty({ type: String, example: "130.00" })
  totalPendingConfirmation!: string;

  @ApiProperty({ type: String, example: "40.00" })
  totalOnCredit!: string;

  @ApiPropertyOptional({ nullable: true })
  notes!: string | null;

  @ApiProperty({ format: "uuid" })
  settledById!: string;

  @ApiProperty({ format: "date-time" })
  settledAt!: Date;
}

export class RouteSettlementDifferencesDto {
  @ApiProperty({
    description: "fullOut - (fullDelivered + fullSold + fullReturned); 0 significa que cuadró",
  })
  containers!: number;

  @ApiProperty({
    description:
      "Recogidos según el ledger (EMPTY_PICKUP) menos los contados; 0 significa que cuadró",
  })
  empties!: number;
}

/** Response of GET .../settlement — served whether the route is settled or not. */
export class GetRouteSettlementResponseDto {
  @ApiProperty({ type: RouteSettlementExpectedDto })
  expected!: RouteSettlementExpectedDto;

  @ApiPropertyOptional({ type: RouteSettlementDto, nullable: true })
  settlement!: RouteSettlementDto | null;

  @ApiProperty({ description: "Paradas de la ruta que siguen PENDING" })
  unresolvedStops!: number;
}

/** Response of POST .../settlement. */
export class CreateRouteSettlementResponseDto {
  @ApiProperty({ type: RouteSettlementDto })
  settlement!: RouteSettlementDto;

  @ApiProperty({ type: RouteSettlementDifferencesDto })
  differences!: RouteSettlementDifferencesDto;
}
