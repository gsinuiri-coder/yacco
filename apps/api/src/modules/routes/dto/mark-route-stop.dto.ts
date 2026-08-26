import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { StopStatus } from "@prisma/client";
import {
  MAX_ITEM_QUANTITY,
  MONEY_MESSAGE,
  MONEY_PATTERN,
} from "../../orders/dto/create-order.dto.js";

const MARKABLE_STATUSES = [StopStatus.DELIVERED, StopStatus.FAILED] as const;

/**
 * `unitPrice` is optional on purpose (unlike CreateOrderItemDto's, which is
 * always required): the normal path lets SalesService resolve the price from
 * CustomerPrice/Product itself. It is only present when the driver charged
 * something different from the agreement — see `priceOverrideAuthorizedById`
 * on MarkRouteStopDto.
 */
export class DeliverySaleItemDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID("4", { message: "El producto debe ser un identificador válido" })
  productId!: string;

  @ApiProperty({ minimum: 1, example: 2 })
  @IsInt({ message: "La cantidad debe ser un número entero" })
  @Min(1, { message: "La cantidad debe ser mayor que 0" })
  @Max(MAX_ITEM_QUANTITY, { message: `La cantidad no puede superar ${MAX_ITEM_QUANTITY}` })
  quantity!: number;

  @ApiPropertyOptional({
    type: String,
    example: "12.50",
    description: "Solo si se cobró distinto del precio pactado",
  })
  @IsOptional()
  @IsString({ message: `El precio unitario ${MONEY_MESSAGE}` })
  @Matches(MONEY_PATTERN, { message: `El precio unitario ${MONEY_MESSAGE}` })
  unitPrice?: string;
}

export class ContainerReturnDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID("4", { message: "El tipo de envase debe ser un identificador válido" })
  containerTypeId!: string;

  @ApiProperty({ minimum: 1, example: 2 })
  @IsInt({ message: "La cantidad debe ser un número entero" })
  @Min(1, { message: "La cantidad debe ser mayor que 0" })
  quantity!: number;
}

export class DeliveryPaymentDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID("4", { message: "El método de pago debe ser un identificador válido" })
  paymentMethodId!: string;

  @ApiProperty({ type: String, example: "25.00" })
  @IsString({ message: `El monto ${MONEY_MESSAGE}` })
  @Matches(MONEY_PATTERN, { message: `El monto ${MONEY_MESSAGE}` })
  amount!: string;
}

/**
 * Only the two terminal statuses are settable through this route — PENDING
 * is the only status a stop is ever created with, never assigned back to.
 * Whether `failureReason` is required/forbidden depends on `status`, so — as
 * in CreateRouteStopDto — the field stays optional here and
 * RoutesService.markStop enforces the actual combination.
 *
 * `items`/`containersReturned`/`payment`/`priceOverrideAuthorizedById` only
 * apply to status=DELIVERED; RoutesService rejects them on a FAILED stop the
 * same way it already rejects a FAILED stop carrying no failureReason.
 */
export class MarkRouteStopDto {
  @ApiProperty({ enum: MARKABLE_STATUSES })
  @IsIn(MARKABLE_STATUSES, { message: "El estado debe ser DELIVERED o FAILED" })
  status!: StopStatus;

  @ApiPropertyOptional({ description: "Obligatorio cuando status=FAILED" })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: "El motivo de falla no puede estar vacío" })
  failureReason?: string;

  @ApiPropertyOptional({
    type: DeliverySaleItemDto,
    isArray: true,
    description: "Obligatorio cuando status=DELIVERED: lo que se vendió en esta parada",
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: "La entrega debe tener al menos un ítem" })
  @ValidateNested({ each: true })
  @Type(() => DeliverySaleItemDto)
  items?: DeliverySaleItemDto[];

  @ApiPropertyOptional({ type: ContainerReturnDto, isArray: true })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContainerReturnDto)
  containersReturned?: ContainerReturnDto[];

  @ApiPropertyOptional({ type: DeliveryPaymentDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DeliveryPaymentDto)
  payment?: DeliveryPaymentDto;

  @ApiPropertyOptional({
    format: "uuid",
    description: "Obligatorio cuando algún unitPrice difiere del precio pactado",
  })
  @IsOptional()
  @IsUUID("4", { message: "Quien autoriza el precio debe ser un identificador válido" })
  priceOverrideAuthorizedById?: string;
}
