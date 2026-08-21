import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested,
} from "class-validator";

// Money crosses the wire as a string (CLAUDE.md): a JSON number is an
// IEEE-754 double, so accepting one would put S/ amounts through binary
// floating point before Postgres ever sees them. NUMERIC(10,2) => at most 8
// integer digits and 2 decimals.
export const MONEY_PATTERN = /^\d{1,8}(\.\d{1,2})?$/;
export const MONEY_MESSAGE =
  'debe ser un monto en soles con hasta 8 enteros y 2 decimales, como texto (ej. "12.50")';

// Calendar date in America/Lima, stored as a DATE column — never a timestamp.
export const BUSINESS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const BUSINESS_DATE_MESSAGE = "debe tener el formato AAAA-MM-DD";

// order_items_quantity_check enforces quantity > 0 in the database. Validating
// it here turns a raw constraint violation into a message the seller can act on.
export const MAX_ITEM_QUANTITY = 100000;

export class CreateOrderItemDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID("4", { message: "El producto debe ser un identificador válido" })
  productId!: string;

  @ApiProperty({ minimum: 1, example: 3 })
  @IsInt({ message: "La cantidad debe ser un número entero" })
  @Min(1, { message: "La cantidad debe ser mayor que 0" })
  @Max(MAX_ITEM_QUANTITY, { message: `La cantidad no puede superar ${MAX_ITEM_QUANTITY}` })
  quantity!: number;

  @ApiProperty({ type: String, example: "12.50", description: "Precio unitario en soles (S/)" })
  @IsString({ message: `El precio unitario ${MONEY_MESSAGE}` })
  @Matches(MONEY_PATTERN, { message: `El precio unitario ${MONEY_MESSAGE}` })
  unitPrice!: string;
}

/**
 * `status` is deliberately absent: an order is always born PENDING (spec
 * HU-06 E1) and the transitions to ON_ROUTE/DELIVERED/FAILED belong to the
 * routes module. `createdById` is absent too — it comes from the access
 * token, never from the body. With the global ValidationPipe's
 * forbidNonWhitelisted, a body carrying either is rejected with 400.
 */
export class CreateOrderDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID("4", { message: "El cliente debe ser un identificador válido" })
  customerId!: string;

  @ApiProperty({ example: "2026-08-25", description: "Día de entrega (America/Lima)" })
  @IsString({ message: `La fecha de entrega ${BUSINESS_DATE_MESSAGE}` })
  @Matches(BUSINESS_DATE_PATTERN, { message: `La fecha de entrega ${BUSINESS_DATE_MESSAGE}` })
  deliveryDate!: string;

  @ApiProperty({ type: CreateOrderItemDto, isArray: true })
  @IsArray()
  @ArrayMinSize(1, { message: "El pedido debe tener al menos un ítem" })
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];
}
