import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsDateString, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

export class CreateVehicleReviewDto {
  @ApiProperty({
    description: "ID del tipo de revisión",
    example: "550e8400-e29b-41d4-a716-446655440000",
  })
  @IsUUID()
  @IsNotEmpty()
  reviewTypeId!: string;

  @ApiProperty({
    description: "Fecha de inicio (día calendario AAAA-MM-DD)",
    example: "2026-10-12",
  })
  @IsDateString()
  @IsNotEmpty()
  startsOn!: string;

  @ApiProperty({
    description: "Fecha de vencimiento (día calendario AAAA-MM-DD)",
    example: "2027-10-12",
  })
  @IsDateString()
  @IsNotEmpty()
  endsOn!: string;

  @ApiPropertyOptional({ description: "Notas u observaciones", example: "Póliza RIMAC N° 123456" })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
