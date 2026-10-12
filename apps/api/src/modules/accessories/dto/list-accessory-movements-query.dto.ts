import { ApiPropertyOptional } from "@nestjs/swagger";
import { AccessoryMovementType } from "@prisma/client";
import { Type } from "class-transformer";
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min } from "class-validator";

export class ListAccessoryMovementsQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ enum: AccessoryMovementType })
  @IsOptional()
  @IsEnum(AccessoryMovementType)
  type?: AccessoryMovementType;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID("4")
  locationId?: string;

  @ApiPropertyOptional({ example: "2026-10-01" })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ example: "2026-10-31" })
  @IsOptional()
  @IsString()
  endDate?: string;
}
