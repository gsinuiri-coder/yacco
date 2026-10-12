import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsLatitude, IsLongitude, IsOptional, IsString, Matches } from "class-validator";

export class CreateCoordinateRequestDto {
  @ApiProperty({ example: "-12.046374", description: "Latitud propuesta (-90 a 90)" })
  @IsString({ message: "La latitud debe ser texto" })
  @IsLatitude({ message: "La latitud debe estar entre -90 y 90" })
  latitude!: string;

  @ApiProperty({ example: "-77.042793", description: "Longitud propuesta (-180 a 180)" })
  @IsString({ message: "La longitud debe ser texto" })
  @IsLongitude({ message: "La longitud debe estar entre -180 y 180" })
  longitude!: string;

  @ApiPropertyOptional({ example: "5.50", description: "Precisión en metros (opcional)" })
  @IsOptional()
  @IsString({ message: "La precisión debe ser texto" })
  @Matches(/^\d{1,8}(\.\d{1,2})?$/, {
    message: "La precisión debe ser un número positivo con hasta 2 decimales",
  })
  accuracyM?: string | null;
}
