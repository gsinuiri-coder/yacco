import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateNested,
} from "class-validator";
import {
  BUSINESS_DATE_MESSAGE,
  BUSINESS_DATE_PATTERN,
  CreateOrderItemDto,
} from "./create-order.dto.js";

export class CreateLocationOrderDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID("4", { message: "El local debe ser un identificador válido" })
  locationId!: string;

  @ApiProperty({ type: CreateOrderItemDto, isArray: true })
  @IsArray({ message: "Los productos del local deben venir en una lista" })
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];
}

/**
 * One office submission may create one order per selected customer location.
 * Empty `items` means that location was left blank and creates no order.
 */
export class CreateOrdersBatchDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID("4", { message: "El cliente debe ser un identificador válido" })
  customerId!: string;

  @ApiProperty({ example: "2026-10-15", description: "Día de entrega (America/Lima)" })
  @IsString({ message: `La fecha de entrega ${BUSINESS_DATE_MESSAGE}` })
  @Matches(BUSINESS_DATE_PATTERN, { message: `La fecha de entrega ${BUSINESS_DATE_MESSAGE}` })
  deliveryDate!: string;

  @ApiPropertyOptional({ format: "uuid", description: "Protege los reintentos del mismo envío" })
  @IsOptional()
  @IsUUID("4", { message: "La clave de idempotencia debe ser un UUID v4" })
  idempotencyKey?: string;

  @ApiProperty({ type: CreateLocationOrderDto, isArray: true })
  @IsArray({ message: "Los locales deben venir en una lista" })
  @ArrayMinSize(1, { message: "Elige al menos un local" })
  @ArrayUnique((location: CreateLocationOrderDto) => location.locationId, {
    message: "Un local no puede aparecer dos veces en el mismo pedido",
  })
  @ValidateNested({ each: true })
  @Type(() => CreateLocationOrderDto)
  locations!: CreateLocationOrderDto[];
}
