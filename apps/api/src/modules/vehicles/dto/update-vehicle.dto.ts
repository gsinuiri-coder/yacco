import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";

export class UpdateVehicleDto {
  @ApiPropertyOptional({
    description: "Placa única del vehículo (solo editable si nunca estuvo en una ruta)",
    example: "ABC123",
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  plate?: string;

  @ApiPropertyOptional({ description: "Nombre o alias del vehículo", example: "Camión 1" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ description: "Marca del vehículo", example: "Toyota" })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  brand?: string;

  @ApiPropertyOptional({ description: "Modelo del vehículo", example: "Dyna" })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  model?: string;

  @ApiPropertyOptional({ description: "Capacidad de carga en bidones", example: 80 })
  @IsOptional()
  @IsInt()
  @Min(0)
  capacityUnits?: number;

  @ApiPropertyOptional({ description: "Categoría o clase del vehículo", example: "N2" })
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

  @ApiPropertyOptional({ description: "Estado activo o desactivado del vehículo", example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
