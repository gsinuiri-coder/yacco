import { ApiProperty } from "@nestjs/swagger";
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsString,
  IsUUID,
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
