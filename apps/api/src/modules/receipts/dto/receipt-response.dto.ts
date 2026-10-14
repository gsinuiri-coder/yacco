import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ReceiptMedium, ReceiptType } from "@prisma/client";

export class ReceiptResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ enum: ReceiptType }) type!: ReceiptType;
  @ApiProperty({ enum: ReceiptMedium }) medium!: ReceiptMedium;
  @ApiProperty() series!: string;
  @ApiProperty() number!: string;
  @ApiProperty({ example: "2026-10-14" }) issuedOn!: string;
  @ApiProperty({ format: "uuid" }) customerId!: string;
  @ApiProperty({ format: "uuid" }) issuerSettingsVersionId!: string;
  @ApiProperty({ example: "100.00" }) taxableAmount!: string;
  @ApiProperty({ example: "18.00" }) taxAmount!: string;
  @ApiProperty({ example: "118.00" }) total!: string;
  @ApiPropertyOptional({ format: "uuid" }) affectedReceiptId!: string | null;
  @ApiPropertyOptional() reason!: string | null;
  @ApiProperty({ format: "uuid" }) createdById!: string;
  @ApiProperty() createdAt!: Date;
  @ApiPropertyOptional() voidedAt!: Date | null;
  @ApiPropertyOptional({ format: "uuid" }) voidedById!: string | null;
  @ApiPropertyOptional() voidReason!: string | null;
}

export class ReceiptExemptionResultDto {
  @ApiProperty() created!: number;
}

export class VoidReceiptResultDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() releasedSales!: number;
}
