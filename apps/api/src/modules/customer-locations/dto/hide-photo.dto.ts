import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class HidePhotoDto {
  @ApiProperty({ example: "Local cambió de fachada", description: "Motivo por el que se oculta" })
  @IsString({ message: "El motivo debe ser texto" })
  @IsNotEmpty({ message: "El motivo es obligatorio" })
  @MaxLength(500, { message: "El motivo no puede superar los 500 caracteres" })
  reason!: string;
}
