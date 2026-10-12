import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

export class AssignRouteVehicleDto {
  @ApiProperty({ description: "ID del vehículo a asignar", example: "550e8400-e29b-41d4-a716-446655440000" })
  @IsUUID()
  @IsNotEmpty()
  vehicleId!: string;

  @ApiPropertyOptional({ description: "Motivo del cambio de vehículo", example: "Falla mecánica en ruta" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
