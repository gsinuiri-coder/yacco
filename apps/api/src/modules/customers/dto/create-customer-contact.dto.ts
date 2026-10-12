import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class CreateCustomerContactDto {
  @ApiProperty({ example: "Juan Pérez", description: "Nombre del contacto" })
  @IsString({ message: "El nombre debe ser texto" })
  @MinLength(1, { message: "El nombre es obligatorio" })
  @MaxLength(160, { message: "El nombre no puede superar los 160 caracteres" })
  name!: string;

  @ApiPropertyOptional({ example: "987654321", description: "Teléfono opcional" })
  @IsOptional()
  @IsString({ message: "El teléfono debe ser texto" })
  @MaxLength(30, { message: "El teléfono no puede superar los 30 caracteres" })
  phone?: string | null;
}
