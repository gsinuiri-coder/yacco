import { ApiProperty } from "@nestjs/swagger";
import { IsInt, IsUUID, Min } from "class-validator";

export class FillMaquilaDto {
  @ApiProperty({ description: "ID del cliente", format: "uuid" })
  @IsUUID("4", { message: "El ID del cliente debe ser un UUID válido" })
  customerId!: string;

  @ApiProperty({ description: "ID del tipo de envase", format: "uuid" })
  @IsUUID("4", { message: "El tipo de envase debe ser un UUID válido" })
  containerTypeId!: string;

  @ApiProperty({ description: "Cantidad de envases llenados", minimum: 1, example: 6 })
  @IsInt({ message: "La cantidad debe ser un número entero" })
  @Min(1, { message: "La cantidad debe ser mayor que 0" })
  quantity!: number;
}
