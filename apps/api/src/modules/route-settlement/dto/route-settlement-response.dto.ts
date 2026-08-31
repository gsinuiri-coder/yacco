import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/**
 * Una cantidad de envases atribuida a su tipo.
 *
 * El nombre viaja con el id a propósito: `GET /container-types` filtra por
 * `active` y no tiene un modo «todos», así que un tipo retirado que todavía
 * vuelve del camión no estaría en el catálogo que la pantalla carga, y se
 * mostraría como un UUID pelado.
 */
export class ContainerQuantityLineDto {
  @ApiProperty({ format: "uuid" })
  containerTypeId!: string;

  @ApiProperty({ example: "Con caño" })
  containerTypeName!: string;

  @ApiProperty({ example: 8 })
  quantity!: number;
}

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

  /**
   * El mismo número de arriba, abierto por tipo de envase: es contra cada una
   * de estas líneas que se cuenta en la puerta, y es de acá que la pantalla
   * arma su hoja de conteo. El total se queda porque hay pantallas y tests
   * que lo leen; ninguno pierde su número.
   */
  @ApiProperty({ type: [ContainerQuantityLineDto], description: "Lo mismo, por tipo de envase" })
  emptiesPickedUpByType!: ContainerQuantityLineDto[];

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

  /**
   * El desglose de lo contado, reconstruido de los `EMPTY_UNLOAD` que emitió
   * la liquidación — no de una columna. `empties_collected` guarda el total y
   * el ledger guarda de qué tipo era cada uno, así que no hizo falta ninguna
   * migración: es la misma razón por la que `differences` se calcula y no se
   * persiste.
   */
  @ApiProperty({ type: [ContainerQuantityLineDto], description: "Lo mismo, por tipo de envase" })
  emptiesCollectedByType!: ContainerQuantityLineDto[];

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

/** La diferencia de un tipo de envase: recogido según el libro menos contado. */
export class ContainerDifferenceLineDto {
  @ApiProperty({ format: "uuid" })
  containerTypeId!: string;

  @ApiProperty({ example: "Con caño" })
  containerTypeName!: string;

  @ApiProperty({
    example: -2,
    description: "Recogidos según el libro menos contados; positivo = faltan, negativo = sobran",
  })
  difference!: number;
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

  /**
   * El total de arriba puede dar cero mientras dos tipos se compensan: +3 de
   * uno y −3 de otro son dos hallazgos distintos, no un cuadre. Por eso el
   * desglose existe.
   *
   * El conjunto de tipos es la UNIÓN de lo recogido y lo contado: un tipo que
   * el libro registró y nadie contó da diferencia positiva, y uno contado que
   * el libro no registró da negativa. Ninguno de los dos se descarta —
   * justamente son el hallazgo.
   */
  @ApiProperty({ type: [ContainerDifferenceLineDto], description: "Lo mismo, por tipo de envase" })
  emptiesByType!: ContainerDifferenceLineDto[];
}

/** Response of GET .../settlement — served whether the route is settled or not. */
export class GetRouteSettlementResponseDto {
  @ApiProperty({ type: RouteSettlementExpectedDto })
  expected!: RouteSettlementExpectedDto;

  @ApiPropertyOptional({ type: RouteSettlementDto, nullable: true })
  settlement!: RouteSettlementDto | null;

  @ApiProperty({ description: "Paradas de la ruta que siguen PENDING" })
  unresolvedStops!: number;

  /**
   * La ruta se liquidó y DESPUÉS se corrigió alguna de sus paradas, así que
   * los números de la liquidación guardada ya no son los del libro. No
   * bloquea nada: corregir una ruta liquidada está permitido a propósito, y
   * esto es lo que se lo cuenta a quien mira la pantalla.
   *
   * `false` cuando no hay liquidación —no hay nada que pueda estar
   * desactualizado— y cuando la última corrección es anterior al cierre.
   *
   * Sale de `route_stops.corrected_at`, no del `voided_at` de las ventas: ver
   * `RouteSettlementService.getSettlementView`.
   *
   * Dice eso y nada más. NO es «la liquidación dejó de cuadrar con el libro»
   * en general: confirmar o rechazar un cobro pendiente después de liquidar
   * también mueve `totalCashCollected` y `totalPendingConfirmation` de
   * `expected`, y no estampa ninguna corrección. Ese otro desfase se ve
   * comparando `expected` contra `settlement`, que ya viajan los dos.
   */
  @ApiProperty({ description: "La liquidación es anterior a la última corrección de una parada" })
  settlementOutdated!: boolean;
}

/** Response of POST .../settlement. */
export class CreateRouteSettlementResponseDto {
  @ApiProperty({ type: RouteSettlementDto })
  settlement!: RouteSettlementDto;

  @ApiProperty({ type: RouteSettlementDifferencesDto })
  differences!: RouteSettlementDifferencesDto;
}
