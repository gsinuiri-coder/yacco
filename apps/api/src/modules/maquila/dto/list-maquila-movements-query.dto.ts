import { ApiPropertyOptional } from "@nestjs/swagger";
import { MaquilaMovementType } from "@prisma/client";
import { Type } from "class-transformer";
import { IsDateString, IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from "class-validator";

export class ListMaquilaMovementsQueryDto {
  @ApiPropertyOptional({ description: "Filtrar por cliente", format: "uuid" })
  @IsOptional()
  @IsUUID("4")
  customerId?: string;

  @ApiPropertyOptional({ enum: MaquilaMovementType, description: "Filtrar por tipo de movimiento" })
  @IsOptional()
  @IsEnum(MaquilaMovementType)
  type?: MaquilaMovementType;

  @ApiPropertyOptional({ description: "Fecha inicial (AAAA-MM-DD)" })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: "Fecha final (AAAA-MM-DD)" })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ description: "Número de página", default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: "Elementos por página", default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
