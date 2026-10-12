import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";

export class VoidMaquilaMovementDto {
  @ApiProperty({ description: "Motivo de la anulación", example: "Error en conteo al recibir" })
  @IsString({ message: "El motivo debe ser un texto" })
  @IsNotEmpty({ message: "El motivo no puede estar vacío" })
  reason!: string;
}
