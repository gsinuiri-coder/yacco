import { ApiProperty } from "@nestjs/swagger";

export class RouteLocationPointsReceiptDto {
  @ApiProperty({ example: 3, description: "Puntos que llegaron en el lote" })
  received!: number;

  @ApiProperty({ example: 2, description: "Puntos nuevos guardados; los repetidos no cuentan" })
  stored!: number;
}

export class RouteLocationPointDto {
  @ApiProperty({ type: String, example: "-12.046374" })
  latitude!: string;

  @ApiProperty({ type: String, example: "-77.042793" })
  longitude!: string;

  @ApiProperty({ type: String, nullable: true, example: "12.50" })
  accuracyM!: string | null;

  @ApiProperty({ format: "date-time", description: "Hora del celular" })
  recordedAt!: string;

  @ApiProperty({ format: "date-time", description: "Hora en que llegó al servidor" })
  receivedAt!: string;

  @ApiProperty({ type: String, nullable: true, example: "ABC123" })
  vehiclePlate!: string | null;
}

export class LiveRouteLocationDto {
  @ApiProperty({ format: "uuid" })
  routeId!: string;

  @ApiProperty({ example: "2026-10-19" })
  date!: string;

  @ApiProperty({ example: "Juan Pérez" })
  driverName!: string;

  @ApiProperty({ type: String, nullable: true, example: "ABC123" })
  vehiclePlate!: string | null;

  @ApiProperty({ type: RouteLocationPointDto, nullable: true })
  lastPoint!: RouteLocationPointDto | null;

  @ApiProperty({
    description: "Sin puntos, o el último tiene más de staleAfterMinutes",
  })
  noSignal!: boolean;
}

export class LiveRouteLocationsDto {
  @ApiProperty({ example: 15 })
  staleAfterMinutes!: number;

  @ApiProperty({ type: LiveRouteLocationDto, isArray: true })
  routes!: LiveRouteLocationDto[];
}
