import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ReceiptMedium, ReceiptType } from "@prisma/client";
import { Type } from "class-transformer";
import { IsEnum, IsInt, IsOptional, IsUUID, Matches, Max, Min } from "class-validator";
import {
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
  MAX_LIMIT,
} from "../../customers/dto/list-customers-query.dto.js";

export enum ReceiptStatus {
  ACTIVE = "ACTIVE",
  VOIDED = "VOIDED",
}

export enum SaleReceiptStatus {
  AVAILABLE = "AVAILABLE",
  RECEIPTED = "RECEIPTED",
  EXEMPT = "EXEMPT",
}

const BUSINESS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

class ReceiptPaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: DEFAULT_PAGE })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: "La página debe ser un número entero" })
  @Min(1, { message: "La página debe ser 1 o mayor" })
  page: number = DEFAULT_PAGE;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: "El tamaño de página debe ser un número entero" })
  @Min(1, { message: "El tamaño de página debe ser 1 o mayor" })
  @Max(MAX_LIMIT, { message: `El tamaño de página no puede superar ${MAX_LIMIT}` })
  limit: number = DEFAULT_LIMIT;
}

export class ListReceiptsQueryDto extends ReceiptPaginationQueryDto {
  @ApiPropertyOptional({ enum: ReceiptType })
  @IsOptional()
  @IsEnum(ReceiptType, { message: "El tipo no es un tipo de comprobante válido" })
  type?: ReceiptType;

  @ApiPropertyOptional({ enum: ReceiptMedium })
  @IsOptional()
  @IsEnum(ReceiptMedium, { message: "El medio no es un medio de comprobante válido" })
  medium?: ReceiptMedium;

  @ApiPropertyOptional({ enum: ReceiptStatus })
  @IsOptional()
  @IsEnum(ReceiptStatus, { message: "El estado no es un estado de comprobante válido" })
  status?: ReceiptStatus;

  @ApiPropertyOptional({ example: "2026-10-01" })
  @IsOptional()
  @Matches(BUSINESS_DATE_PATTERN, { message: "La fecha desde debe ser AAAA-MM-DD" })
  issuedFrom?: string;

  @ApiPropertyOptional({ example: "2026-10-14" })
  @IsOptional()
  @Matches(BUSINESS_DATE_PATTERN, { message: "La fecha hasta debe ser AAAA-MM-DD" })
  issuedTo?: string;
}

export class ListReceiptSalesQueryDto extends ReceiptPaginationQueryDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID("4", { message: "El cliente debe ser un identificador válido" })
  customerId!: string;

  @ApiPropertyOptional({ enum: SaleReceiptStatus })
  @IsOptional()
  @IsEnum(SaleReceiptStatus, { message: "El estado no es un estado de venta válido" })
  status?: SaleReceiptStatus;
}
