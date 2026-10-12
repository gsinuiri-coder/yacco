import { ApiProperty } from "@nestjs/swagger";
import { IsInt, IsUUID, Min } from "class-validator";

export class ReturnAccessoryDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID("4", { message: "El ID del producto debe ser un UUID válido" })
  productId!: string;

  @ApiProperty({ example: 1 })
  @IsInt({ message: "La cantidad debe ser un número entero" })
  @Min(1, { message: "La cantidad debe ser al menos 1" })
  quantity!: number;
}
