import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { PaymentStatus, RouteStatus, StopOrigin, StopStatus } from "@prisma/client";

export class RouteDriverDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;
}

export class RouteZoneDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;
}

/**
 * A quién pertenece la ubicación de la parada. Sin esto una hoja de ruta
 * repite "Principal" en cada fila — el nombre de la locación principal de
 * todo cliente — y la oficina no puede saber a quién va cada parada sin
 * cruzar la dirección a mano contra la lista de clientes.
 */
export class RouteStopCustomerDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;
}

export class RouteStopLocationDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  address!: string;

  @ApiProperty({ type: RouteStopCustomerDto })
  customer!: RouteStopCustomerDto;
}

export class RouteStopContainerTypeDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;
}

/**
 * La venta VIGENTE de la parada. Viene en la respuesta de marcar o corregir la
 * parada, y en el detalle de una ruta (`GET /routes/:id`); nunca al listar
 * rutas.
 *
 * Las ventas ANULADAS no viajan por acá — corregir una parada deja la anterior
 * en la tabla, anulada, y esa historia se lee en el estado de cuenta del
 * cliente y en el libro de movimientos.
 */
export class RouteStopSaleDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  /** 2-decimal string: a NUMERIC(10,2) never round-trips through a JSON number. */
  @ApiProperty({ type: String, example: "25.00" })
  total!: string;

  @ApiProperty({
    description:
      "La venta supera el límite de crédito del cliente — se registra igual, nunca bloquea",
  })
  creditLimitExceeded!: boolean;
}

/** Quién corrigió la parada — `name`, igual que el chofer y el cliente. */
export class RouteStopCorrectedByDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;
}

/**
 * La corrección de la parada: cuándo, quién y por qué. `null` mientras la
 * parada nunca se corrigió.
 *
 * Las tres columnas guardan SÓLO LA ÚLTIMA corrección de esta parada: una
 * segunda corrección las pisa. Es deliberado — la historia completa vive en
 * las ventas anuladas y en el libro de movimientos. Ver
 * `RoutesService.correctStop`.
 */
export class RouteStopCorrectionDto {
  @ApiProperty({ format: "date-time" })
  correctedAt!: Date;

  @ApiProperty({ type: RouteStopCorrectedByDto })
  correctedBy!: RouteStopCorrectedByDto;

  @ApiPropertyOptional({ nullable: true })
  correctionReason!: string | null;
}

/**
 * El cobro NO ANULADO de la parada; `null` cuando no hay ninguno.
 *
 * «No anulado» no es lo mismo que «cobrado»: un cobro RECHAZADO —el dinero
 * nunca llegó, así que no hubo nada que revertir— sigue viniendo por acá. Por
 * eso `status` viaja con el monto, y la pantalla lo muestra: un monto solo
 * diría que se cobró algo que no entró.
 */
export class RouteStopPaymentDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ enum: PaymentStatus })
  status!: PaymentStatus;

  @ApiProperty({ type: String, example: "25.00" })
  amount!: string;
}

/** Resulting container balance at the location, for each type the delivery touched. */
export class RouteStopContainerBalanceDto {
  @ApiProperty({ format: "uuid" })
  containerTypeId!: string;

  @ApiProperty({ type: RouteStopContainerTypeDto })
  containerType!: RouteStopContainerTypeDto;

  @ApiProperty({ example: 3 })
  quantity!: number;
}

/**
 * Un tipo de envase del que se registró más de lo que el camión tenía. Solo
 * puede venir poblado desde la corrección de una parada, que registra contra un
 * hecho físico ya consumado y por eso avisa en vez de bloquear; en una entrega
 * normal el faltante es un 400 y esta lista viaja vacía.
 */
export class RouteStopStockShortfallDto {
  @ApiProperty({ format: "uuid" })
  containerTypeId!: string;

  @ApiProperty({ type: RouteStopContainerTypeDto })
  containerType!: RouteStopContainerTypeDto;

  @ApiProperty({ example: 2, description: "Lo que el libro decía que quedaba en el camión" })
  available!: number;

  @ApiProperty({ example: 5, description: "Lo que se registró como entregado" })
  requested!: number;
}

export class RouteStopResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "uuid" })
  routeId!: string;

  @ApiProperty({ example: 1 })
  position!: number;

  @ApiProperty({ enum: StopOrigin })
  origin!: StopOrigin;

  @ApiProperty({ format: "uuid" })
  locationId!: string;

  @ApiProperty({ type: RouteStopLocationDto })
  location!: RouteStopLocationDto;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  orderId!: string | null;

  @ApiProperty({ enum: StopStatus })
  status!: StopStatus;

  /**
   * OJO al mostrarlo: una parada corregida de FAILED a DELIVERED CONSERVA el
   * motivo de falla original a propósito (es la evidencia de que hubo un error
   * de anotación — ver `RoutesService.correctStop`), así que este campo puede
   * venir lleno con `status = DELIVERED`. Se muestra únicamente cuando la
   * parada está FAILED; si no, la pantalla diría «Entregada — Nadie atendió».
   */
  @ApiPropertyOptional({ nullable: true })
  failureReason!: string | null;

  @ApiProperty({ type: RouteStopCorrectionDto, nullable: true })
  correction!: RouteStopCorrectionDto | null;

  @ApiPropertyOptional({ type: RouteStopSaleDto, nullable: true })
  sale?: RouteStopSaleDto | null;

  @ApiPropertyOptional({ type: RouteStopPaymentDto, nullable: true })
  payment?: RouteStopPaymentDto | null;

  @ApiPropertyOptional({ type: RouteStopContainerBalanceDto, isArray: true })
  containerBalances?: RouteStopContainerBalanceDto[];

  @ApiPropertyOptional({ type: RouteStopStockShortfallDto, isArray: true })
  stockShortfall?: RouteStopStockShortfallDto[];
}

export class RouteResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  /**
   * Calendar day in America/Lima, as `YYYY-MM-DD` — a DATE column, never
   * serialized as an instant. Same convention as Order.deliveryDate.
   */
  @ApiProperty({ type: String, example: "2026-08-25" })
  date!: string;

  @ApiProperty({ format: "uuid" })
  driverId!: string;

  @ApiProperty({ type: RouteDriverDto })
  driver!: RouteDriverDto;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  zoneId!: string | null;

  @ApiPropertyOptional({ type: RouteZoneDto, nullable: true })
  zone!: RouteZoneDto | null;

  @ApiProperty({ enum: RouteStatus })
  status!: RouteStatus;

  @ApiProperty({ format: "uuid" })
  createdById!: string;

  @ApiProperty({ format: "date-time" })
  createdAt!: Date;

  @ApiProperty({ type: RouteStopResponseDto, isArray: true })
  stops!: RouteStopResponseDto[];
}

export class PaginatedRoutesDto {
  @ApiProperty({ type: RouteResponseDto, isArray: true })
  data!: RouteResponseDto[];

  @ApiProperty({ description: "Total de rutas que cumplen el filtro" })
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty({ description: "Número total de páginas para el filtro actual" })
  totalPages!: number;
}
