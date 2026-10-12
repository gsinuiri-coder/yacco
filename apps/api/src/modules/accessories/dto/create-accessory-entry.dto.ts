import { ApiProperty } from "@nestjs/swagger";
import { IsInt, Min } from "class-validator";

export class CreateAccessoryEntryDto {
  @ApiProperty({ example: 10, description: "Cantidad de unidades que ingresan a planta" })
  @IsInt({ message: "La cantidad debe ser un número entero" })
  @Min(1, { message: "La cantidad debe ser al menos 1" })
  quantity!: number;
}
