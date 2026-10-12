import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from "class-validator";

export class CreateVehicleDto {
  @ApiProperty({ description: "Placa única del vehículo (se normaliza en mayúsculas sin guiones)", example: "ABC123" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  plate!: string;

  @ApiProperty({ description: "Nombre o alias del vehículo", example: "Camión 1" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ description: "Marca del vehículo", example: "Toyota" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  brand!: string;

  @ApiProperty({ description: "Modelo del vehículo", example: "Dyna" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  model!: string;

  @ApiPropertyOptional({ description: "Capacidad de carga en bidones", example: 80 })
  @IsOptional()
  @IsInt()
  @Min(0)
  capacityUnits?: number;

  @ApiPropertyOptional({ description: "Categoría o clase del vehículo para guías de remisión", example: "N2" })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  vehicleClass?: string;

  @ApiPropertyOptional({
    description: "Número de tarjeta única de circulación o certificado de habilitación",
    example: "TUC-987654321",
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  circulationCardNumber?: string;
}
