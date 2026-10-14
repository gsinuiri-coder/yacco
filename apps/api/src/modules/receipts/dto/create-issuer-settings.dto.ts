import { ApiProperty } from "@nestjs/swagger";
import { IsString, Matches, MaxLength, MinLength } from "class-validator";

export class CreateIssuerSettingsDto {
  @ApiProperty({ example: "20123456789" })
  @IsString()
  @Matches(/^\d{11}$/, { message: "El RUC del emisor debe tener exactamente 11 dígitos" })
  taxId!: string;

  @ApiProperty({ example: "Yacco S.A.C." })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  legalName!: string;

  @ApiProperty({ example: "Av. Planta 123, Lima" })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  fiscalAddress!: string;

  @ApiProperty({ example: "18.00", description: "Porcentaje con dos decimales" })
  @IsString()
  @Matches(/^\d{1,3}\.\d{2}$/, {
    message: "La tasa de IGV debe ser un texto con dos decimales (ej. 18.00)",
  })
  taxRate!: string;

  @ApiProperty({ example: "700.00", description: "Monto en soles con dos decimales" })
  @IsString()
  @Matches(/^\d{1,8}\.\d{2}$/, {
    message: "El monto para exigir documento debe tener dos decimales (ej. 700.00)",
  })
  receiptDocumentThreshold!: string;
}
