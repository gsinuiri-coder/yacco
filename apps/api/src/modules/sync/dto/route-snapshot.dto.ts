import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ProductType } from "@prisma/client";
import { IsOptional, IsUUID } from "class-validator";
import { EffectivePriceResponseDto } from "../../customer-prices/dto/effective-price-response.dto.js";
import { RouteTruckStockLineDto } from "../../routes/dto/route-load-response.dto.js";
import { RouteResponseDto } from "../../routes/dto/route-response.dto.js";

/**
 * Sin `routeId`, la ruta del chofer en curso o, si no tiene, la de hoy. Con
 * `routeId`, el ADMIN prueba la de cualquiera; el chofer solo puede nombrar la
 * suya de hoy o la que tiene en curso. No recibe la posición del celular: los
 * locales para venta en ruta los acota el servidor con las paradas.
 */
export class RouteSnapshotQueryDto {
  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID("4", { message: "La ruta debe ser un identificador válido" })
  routeId?: string;
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

  @ApiProperty({
    example: 300,
    description: "Cada cuántos segundos guarda el celular su ubicación con la ruta en curso",
  })
  locationIntervalSeconds!: number;
}
