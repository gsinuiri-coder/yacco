import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Min } from "class-validator";
import { MONEY_MESSAGE, MONEY_PATTERN } from "../../customers/dto/create-customer.dto.js";

export class ChargeAccessoryDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID("4", { message: "El ID del producto debe ser un UUID válido" })
  productId!: string;

  @ApiProperty({ example: 1 })
  @IsInt({ message: "La cantidad debe ser un número entero" })
  @Min(1, { message: "La cantidad debe ser al menos 1" })
  quantity!: number;

  @ApiProperty({ example: "Cliente extravió el surtidor y solicita comprarlo" })
  @IsString({ message: "El motivo debe ser una cadena de texto" })
  @IsNotEmpty({ message: "El motivo no puede estar vacío" })
  reason!: string;

  @ApiPropertyOptional({ example: "25.00" })
  @IsOptional()
  @Matches(MONEY_PATTERN, { message: `El precio unitario ${MONEY_MESSAGE}` })
  unitPrice?: string;
}
