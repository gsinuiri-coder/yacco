import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ProductType } from "@prisma/client";
import {
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateIf,
} from "class-validator";
import { EffectivePriceResponseDto } from "../../customer-prices/dto/effective-price-response.dto.js";
import { RouteTruckStockLineDto } from "../../routes/dto/route-load-response.dto.js";
import { RouteResponseDto } from "../../routes/dto/route-response.dto.js";
import { COORDINATE_PATTERN } from "../../routes/dto/mark-route-stop.dto.js";

/**
 * Sin `routeId`, la ruta del chofer en curso o, si no tiene, la de hoy. Con
 * `routeId`, el ADMIN prueba la de cualquiera; el chofer solo puede nombrar la
 * suya de hoy o la que tiene en curso. La posición, si viene, suma los locales
 * a menos de 1 km para la venta en ruta.
 */
export class RouteSnapshotQueryDto {
  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID("4", { message: "La ruta debe ser un identificador válido" })
  routeId?: string;

  @ApiPropertyOptional({ type: String, example: "-12.046374" })
  @ValidateIf(
    (dto: RouteSnapshotQueryDto) => dto.latitude !== undefined || dto.longitude !== undefined,
  )
  @IsString({ message: "La latitud debe ser un texto decimal" })
  @Matches(COORDINATE_PATTERN, { message: "La latitud admite hasta 6 decimales" })
  @IsLatitude({ message: "La latitud debe estar entre -90 y 90" })
  latitude?: string;

  @ApiPropertyOptional({ type: String, example: "-77.042793" })
  @ValidateIf(
    (dto: RouteSnapshotQueryDto) => dto.latitude !== undefined || dto.longitude !== undefined,
  )
  @IsString({ message: "La longitud debe ser un texto decimal" })
  @Matches(COORDINATE_PATTERN, { message: "La longitud admite hasta 6 decimales" })
  @IsLongitude({ message: "La longitud debe estar entre -180 y 180" })
  longitude?: string;
}

class NamedDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;
}

export class SnapshotContainerBalanceDto {
  @ApiProperty({ type: NamedDto })
  containerType!: NamedDto;

  @ApiProperty({ description: "Envases que el local tiene de la planta; negativo es un faltante" })
  quantity!: number;
}

export class SnapshotAccessoryBalanceDto {
  @ApiProperty({ type: NamedDto })
  product!: NamedDto;

  @ApiProperty({ description: "Accesorios prestados que siguen en el local" })
  quantity!: number;
}

/** Un local que el chofer puede visitar hoy: una parada suya o uno para venta en ruta. */
export class SnapshotLocationDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  address!: string;

  @ApiProperty()
  addressReference!: string;

  @ApiProperty()
  phone!: string;

  @ApiProperty({ type: String, nullable: true })
  contactName!: string | null;

  @ApiProperty({ type: String, nullable: true, example: "-12.046374" })
  latitude!: string | null;

  @ApiProperty({ type: String, nullable: true, example: "-77.042793" })
  longitude!: string | null;

  @ApiProperty({ description: "Tiene una parada en la ruta" })
  onRoute!: boolean;

  @ApiProperty({ type: NamedDto })
  customer!: NamedDto;

  @ApiProperty({ type: String, example: "12.50", description: "Deuda del cliente en S/" })
  debtBalance!: string;

  @ApiProperty({ type: String, nullable: true, example: "100.00" })
  creditLimit!: string | null;

  @ApiProperty({ type: SnapshotContainerBalanceDto, isArray: true })
  containerBalances!: SnapshotContainerBalanceDto[];

  @ApiProperty({ type: SnapshotAccessoryBalanceDto, isArray: true })
  loanedAccessories!: SnapshotAccessoryBalanceDto[];

  @ApiProperty({ type: EffectivePriceResponseDto, isArray: true })
  prices!: EffectivePriceResponseDto[];
}

export class SnapshotOrderItemDto {
  @ApiProperty({ type: NamedDto })
  product!: NamedDto;

  @ApiProperty({ enum: ProductType })
  productType!: ProductType;

  @ApiProperty()
  quantity!: number;

  @ApiProperty({ type: String, example: "8.00" })
  unitPrice!: string;
}

/** Lo que pidió el pedido de una parada (los accesorios van como un ítem más). */
export class SnapshotOrderDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "uuid" })
  stopId!: string;

  @ApiProperty({ type: SnapshotOrderItemDto, isArray: true })
  items!: SnapshotOrderItemDto[];
}

export class SnapshotProductDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: ProductType })
  type!: ProductType;

  @ApiProperty({ type: NamedDto, nullable: true })
  containerType!: NamedDto | null;
}

export class SnapshotPaymentMethodDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  requiresConfirmation!: boolean;
}

/** GET /sync/route-snapshot: todo lo que la app guarda para trabajar sin señal. */
export class RouteSnapshotDto {
  @ApiProperty({ type: String, format: "date-time", description: "Cuándo se armó" })
  generatedAt!: Date;

  @ApiProperty({ type: RouteResponseDto })
  route!: RouteResponseDto;

  @ApiProperty({ type: RouteTruckStockLineDto, isArray: true })
  truckStock!: RouteTruckStockLineDto[];

  @ApiProperty({ type: SnapshotLocationDto, isArray: true })
  locations!: SnapshotLocationDto[];

  @ApiProperty({ type: SnapshotOrderDto, isArray: true })
  orders!: SnapshotOrderDto[];

  @ApiProperty({ type: SnapshotProductDto, isArray: true })
  products!: SnapshotProductDto[];

  @ApiProperty({ type: NamedDto, isArray: true })
  containerTypes!: NamedDto[];

  @ApiProperty({ type: SnapshotPaymentMethodDto, isArray: true })
  paymentMethods!: SnapshotPaymentMethodDto[];
}
