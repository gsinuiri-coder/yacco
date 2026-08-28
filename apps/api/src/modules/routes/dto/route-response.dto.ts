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

/** The delivery's sale, only present on a response for a stop just marked DELIVERED. */
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

/** The delivery's collection, only present when the body carried a `payment`. */
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

  @ApiPropertyOptional({ nullable: true })
  failureReason!: string | null;

  @ApiPropertyOptional({ type: RouteStopSaleDto, nullable: true })
  sale?: RouteStopSaleDto | null;

  @ApiPropertyOptional({ type: RouteStopPaymentDto, nullable: true })
  payment?: RouteStopPaymentDto | null;

  @ApiPropertyOptional({ type: RouteStopContainerBalanceDto, isArray: true })
  containerBalances?: RouteStopContainerBalanceDto[];
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
