import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ReceiptMedium, ReceiptType } from "@prisma/client";
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

export class CreateReceiptDto {
  @ApiProperty({ enum: [ReceiptType.SALES_RECEIPT, ReceiptType.INVOICE] })
  @IsEnum(ReceiptType)
  type!: ReceiptType;

  @ApiProperty({ enum: ReceiptMedium })
  @IsEnum(ReceiptMedium)
  medium!: ReceiptMedium;

  @ApiProperty({ example: "B001" })
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  @Matches(/\S/, { message: "La serie no puede quedar vacía" })
  series!: string;

  @ApiProperty({ example: "000001" })
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  @Matches(/\S/, { message: "El número no puede quedar vacío" })
  number!: string;

  @ApiProperty({ example: "2026-10-14" })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "La fecha de emisión debe ser AAAA-MM-DD" })
  issuedOn!: string;

  @ApiProperty({ format: "uuid" })
  @IsUUID()
  customerId!: string;

  @ApiProperty({ type: [String], format: "uuid" })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  saleIds!: string[];

  @ApiPropertyOptional({
    format: "uuid",
    description: "Comprobante anulado del que se vuelven a asociar los adjuntos",
  })
  @IsOptional()
  @IsUUID()
  filesFromReceiptId?: string;
}
