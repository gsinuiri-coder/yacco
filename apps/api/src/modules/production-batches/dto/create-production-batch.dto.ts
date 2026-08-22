import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import {
  BUSINESS_DATE_MESSAGE,
  BUSINESS_DATE_PATTERN,
  MAX_ITEM_QUANTITY,
} from "../../orders/dto/create-order.dto.js";

export class CreateProductionBatchItemDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID("4", { message: "El tipo de envase debe ser un identificador válido" })
  containerTypeId!: string;

  @ApiProperty({ minimum: 1, example: 200 })
  @IsInt({ message: "La cantidad producida debe ser un número entero" })
  @Min(1, { message: "La cantidad producida debe ser mayor que 0" })
  @Max(MAX_ITEM_QUANTITY, {
    message: `La cantidad producida no puede superar ${MAX_ITEM_QUANTITY}`,
  })
  producedQty!: number;
}

/**
 * `filledById` is absent: it comes from the access token, never the body —
 * same as `createdById` in Orders. There is no update/delete DTO: a batch is
 * corrected with inverse movements, never by editing the past (spec).
 */
export class CreateProductionBatchDto {
  @ApiProperty({ example: "LOTE-2026-08-22-01" })
  @IsString({ message: "El código debe ser un texto" })
  @MinLength(1, { message: "El código no puede estar vacío" })
  code!: string;

  @ApiProperty({ example: "2026-08-22", description: "Día de producción (America/Lima)" })
  @IsString({ message: `La fecha del lote ${BUSINESS_DATE_MESSAGE}` })
  @Matches(BUSINESS_DATE_PATTERN, { message: `La fecha del lote ${BUSINESS_DATE_MESSAGE}` })
  date!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: "Las notas deben ser un texto" })
  notes?: string;

  @ApiProperty({ type: CreateProductionBatchItemDto, isArray: true })
  @IsArray()
  @ArrayMinSize(1, { message: "El lote debe tener al menos una línea" })
  @ValidateNested({ each: true })
  @Type(() => CreateProductionBatchItemDto)
  items!: CreateProductionBatchItemDto[];
}
