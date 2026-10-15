import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ReceiptMedium, ReceiptType } from "@prisma/client";
import { ReceiptStatus, SaleReceiptStatus } from "./list-receipts-query.dto.js";

export class ReceiptCustomerDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() name!: string;
}

export class ReceiptUserDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() username!: string;
}

export class ReceiptLocationDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() name!: string;
}

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

export class ReleaseExemptionResultDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) saleId!: string;
}

export class ReceiptRowDto extends ReceiptResponseDto {
  @ApiProperty({ enum: ReceiptStatus }) status!: ReceiptStatus;
  @ApiProperty({ type: ReceiptCustomerDto }) customer!: ReceiptCustomerDto;
  @ApiProperty({ type: ReceiptUserDto }) createdBy!: ReceiptUserDto;
}

export class PaginatedReceiptsDto {
  @ApiProperty({ type: ReceiptRowDto, isArray: true }) data!: ReceiptRowDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() totalPages!: number;
}

export class ReceiptIssuerSettingsDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() taxId!: string;
  @ApiProperty() legalName!: string;
  @ApiProperty() fiscalAddress!: string;
  @ApiProperty({ example: "18.00" }) taxRate!: string;
  @ApiProperty({ example: "700.00" }) receiptDocumentThreshold!: string;
}

export class ReceiptSaleDetailDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() soldAt!: Date;
  @ApiProperty({ example: "118.00" }) total!: string;
  @ApiProperty({ type: ReceiptLocationDto }) location!: ReceiptLocationDto;
  @ApiPropertyOptional() releasedAt!: Date | null;
}

export class ReceiptFileDto {
  @ApiProperty() fileName!: string;
  @ApiProperty() contentType!: string;
}

export class ReceiptCreditNoteDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() series!: string;
  @ApiProperty() number!: string;
  @ApiProperty({ enum: ReceiptMedium }) medium!: ReceiptMedium;
  @ApiProperty({ enum: ReceiptStatus }) status!: ReceiptStatus;
}

export class ReceiptDetailDto extends ReceiptRowDto {
  @ApiProperty({ type: ReceiptIssuerSettingsDto })
  issuerSettingsVersion!: ReceiptIssuerSettingsDto;

  @ApiProperty({ type: ReceiptSaleDetailDto, isArray: true }) sales!: ReceiptSaleDetailDto[];
  @ApiProperty({ type: ReceiptFileDto, isArray: true }) files!: ReceiptFileDto[];
  @ApiProperty({ type: ReceiptCreditNoteDto, isArray: true })
  creditNotes!: ReceiptCreditNoteDto[];
  @ApiPropertyOptional({ type: ReceiptUserDto, nullable: true })
  voidedBy!: ReceiptUserDto | null;
}

export class ReceiptSaleStatusReceiptDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ enum: ReceiptType }) type!: ReceiptType;
  @ApiProperty() series!: string;
  @ApiProperty() number!: string;
}

export class ReceiptSaleStatusExemptionDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() reason!: string;
}

export class ReceiptSaleStatusRowDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() soldAt!: Date;
  @ApiProperty({ example: "30.00" }) total!: string;
  @ApiProperty({ type: ReceiptLocationDto }) location!: ReceiptLocationDto;
  @ApiProperty({ enum: SaleReceiptStatus }) status!: SaleReceiptStatus;
  @ApiPropertyOptional({ type: ReceiptSaleStatusReceiptDto, nullable: true })
  receipt!: ReceiptSaleStatusReceiptDto | null;
  @ApiPropertyOptional({ type: ReceiptSaleStatusExemptionDto, nullable: true })
  exemption!: ReceiptSaleStatusExemptionDto | null;
}

export class PaginatedReceiptSalesDto {
  @ApiProperty({ type: ReceiptSaleStatusRowDto, isArray: true })
  data!: ReceiptSaleStatusRowDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() totalPages!: number;
}
