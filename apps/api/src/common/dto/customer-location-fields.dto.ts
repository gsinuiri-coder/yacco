import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsLatitude, IsLongitude, IsOptional, IsString, Matches, MaxLength } from "class-validator";

const COORDINATE_PATTERN = /^-?\d{1,3}(?:\.\d{1,6})?$/;

export class CustomerLocationFieldsDto {
  @ApiPropertyOptional({ example: "Rosa Quispe", nullable: true })
  @IsOptional()
  @IsString({ message: "La persona que recibe debe ser un texto" })
  @MaxLength(160, { message: "La persona que recibe no puede superar los 160 caracteres" })
  contactName?: string | null;

  @ApiPropertyOptional({ type: String, example: "-12.046374", nullable: true })
  @IsOptional()
  @IsString({ message: "La latitud debe ser un texto decimal" })
  @Matches(COORDINATE_PATTERN, { message: "La latitud admite hasta 6 decimales" })
  @IsLatitude({ message: "La latitud debe estar entre -90 y 90" })
  latitude?: string | null;

  @ApiPropertyOptional({ type: String, example: "-77.042793", nullable: true })
  @IsOptional()
  @IsString({ message: "La longitud debe ser un texto decimal" })
  @Matches(COORDINATE_PATTERN, { message: "La longitud admite hasta 6 decimales" })
  @IsLongitude({ message: "La longitud debe estar entre -180 y 180" })
  longitude?: string | null;
}
