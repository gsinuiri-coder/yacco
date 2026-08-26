import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { RouteStatus, StopOrigin, StopStatus } from "@prisma/client";

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

export class RouteStopLocationDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  address!: string;
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
