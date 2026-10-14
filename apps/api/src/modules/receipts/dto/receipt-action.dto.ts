import { ApiProperty } from "@nestjs/swagger";
import { ReceiptMedium } from "@prisma/client";
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

export class MarkReceiptExemptionsDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  customerId!: string;

  @ApiProperty({ type: [String], format: "uuid" })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  saleIds!: string[];

  @ApiProperty({ example: "El cliente no solicita comprobante" })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

export class ReceiptReasonDto {
  @ApiProperty({ example: "Se registró con una serie equivocada" })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

export class CreateCreditNoteDto extends ReceiptReasonDto {
  @ApiProperty({ enum: ReceiptMedium })
  @IsEnum(ReceiptMedium)
  medium!: ReceiptMedium;

  @ApiProperty({ example: "BC01" })
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  series!: string;

  @ApiProperty({ example: "000001" })
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  number!: string;

  @ApiProperty({ example: "2026-10-14" })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "La fecha de emisión debe ser AAAA-MM-DD" })
  issuedOn!: string;
}
