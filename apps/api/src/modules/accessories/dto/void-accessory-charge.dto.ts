import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";

export class VoidAccessoryChargeDto {
  @ApiProperty({ example: "Error de digitación, cliente encontró el surtidor" })
  @IsString({ message: "El motivo debe ser una cadena de texto" })
  @IsNotEmpty({ message: "El motivo no puede estar vacío" })
  reason!: string;
}
