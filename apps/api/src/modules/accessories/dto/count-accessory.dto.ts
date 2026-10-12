import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, IsOptional, IsString, Min } from "class-validator";

export class CountAccessoryDto {
  @ApiProperty({ example: 8, description: "Cantidad contada físicamente en planta" })
  @IsInt({ message: "La cantidad debe ser un número entero" })
  @Min(0, { message: "La cantidad no puede ser negativa" })
  countedQuantity!: number;

  @ApiPropertyOptional({
    example: "Faltante por rotura no reportada",
    description: "Motivo obligatorio si la cantidad contada difiere del stock esperado",
  })
  @IsOptional()
  @IsString({ message: "El motivo debe ser una cadena de texto" })
  reason?: string;
}
