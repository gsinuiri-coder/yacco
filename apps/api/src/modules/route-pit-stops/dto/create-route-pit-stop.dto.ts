import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  ValidateNested,
} from "class-validator";

export class CreateRoutePitStopCountDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  containerTypeId!: string;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  countedFull!: number;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  countedEmpty!: number;

  @ApiPropertyOptional({ description: "Obligatorio si counted difiere de expected" })
  @IsOptional()
  @IsString()
  differenceReason?: string;
}

export class CreateRoutePitStopLoadDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  batchItemId!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class CreateRoutePitStopUnloadDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  containerTypeId!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class CreateRoutePitStopDto {
  @ApiProperty({ type: [CreateRoutePitStopCountDto], description: "Cuadre de bidones (siempre)" })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CreateRoutePitStopCountDto)
  counts!: CreateRoutePitStopCountDto[];

  @ApiPropertyOptional({ type: [CreateRoutePitStopLoadDto], description: "Carga FIFO (opcional)" })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateRoutePitStopLoadDto)
  loads?: CreateRoutePitStopLoadDto[];

  @ApiPropertyOptional({
    type: [CreateRoutePitStopUnloadDto],
    description: "Descarga de vacíos (opcional)",
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateRoutePitStopUnloadDto)
  unloadEmpties?: CreateRoutePitStopUnloadDto[];

  @ApiPropertyOptional({
    type: [CreateRoutePitStopUnloadDto],
    description: "Descarga de llenos al lote (opcional)",
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateRoutePitStopUnloadDto)
  returnFulls?: CreateRoutePitStopUnloadDto[];

  @ApiPropertyOptional({
    example: "120.00",
    description:
      "Monto de efectivo entregado (2 decimales; obligatorio cashReason si supera lo esperado)",
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d+\.\d{2}$/, { message: "cashDelivered debe tener 2 decimales (ej. 12.50)" })
  cashDelivered?: string;

  @ApiPropertyOptional({ description: "Obligatorio si cashDelivered supera lo esperado" })
  @IsOptional()
  @IsString()
  cashReason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
