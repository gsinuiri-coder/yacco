import { ApiProperty } from "@nestjs/swagger";
import { ReceiptType } from "@prisma/client";
import { ArrayMinSize, ArrayUnique, IsArray, IsEnum, IsUUID } from "class-validator";

export class PreviewReceiptDto {
  @ApiProperty({ enum: [ReceiptType.SALES_RECEIPT, ReceiptType.INVOICE] })
  @IsEnum(ReceiptType)
  type!: ReceiptType;

  @ApiProperty({ format: "uuid" })
  @IsUUID()
  customerId!: string;

  @ApiProperty({ type: [String], format: "uuid" })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  saleIds!: string[];
}

export class ReceiptPreviewResponseDto {
  @ApiProperty({ format: "uuid" })
  customerId!: string;

  @ApiProperty({ type: [String], format: "uuid" })
  saleIds!: string[];

  @ApiProperty({ format: "uuid" })
  issuerSettingsVersionId!: string;

  @ApiProperty({ example: "18.00" })
  taxRate!: string;

  @ApiProperty({ example: "100.00" })
  taxableAmount!: string;

  @ApiProperty({ example: "18.00" })
  taxAmount!: string;

  @ApiProperty({ example: "118.00" })
  total!: string;
}
