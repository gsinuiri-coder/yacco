import { ApiProperty } from "@nestjs/swagger";
import { IsInt, IsNotEmpty, IsString, Min } from "class-validator";

export class CreateAccessoryWriteOffDto {
  @ApiProperty({
    example: 2,
    description: "Cantidad de unidades dañadas o rotas que se dan de baja",
  })
  @IsInt({ message: "La cantidad debe ser un número entero" })
  @Min(1, { message: "La cantidad debe ser al menos 1" })
  quantity!: number;

  @ApiProperty({ example: "Dañado en transporte", description: "Motivo obligatorio de la baja" })
  @IsString({ message: "El motivo debe ser una cadena de texto" })
  @IsNotEmpty({ message: "El motivo no puede estar vacío" })
  reason!: string;
}
