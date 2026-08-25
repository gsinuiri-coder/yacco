import { ApiProperty } from "@nestjs/swagger";
import { IsString, MaxLength, MinLength } from "class-validator";

/**
 * A container type is exactly this: a name. `active` is not accepted on
 * creation — a type is born active, and withdrawing one is a PATCH.
 */
export class CreateContainerTypeDto {
  @ApiProperty({ example: "Bidón (V)", description: "Nombre único del tipo de envase" })
  @IsString({ message: "El nombre es obligatorio" })
  @MinLength(1, { message: "El nombre es obligatorio" })
  @MaxLength(80, { message: "El nombre no puede superar los 80 caracteres" })
  name!: string;
}
