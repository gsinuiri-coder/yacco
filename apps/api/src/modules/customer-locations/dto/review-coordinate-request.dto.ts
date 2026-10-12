import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";

export class ReviewCoordinateRequestDto {
  @ApiProperty({ enum: ["APPROVED", "REJECTED"], example: "APPROVED" })
  @IsIn(["APPROVED", "REJECTED"], { message: "El estado debe ser APPROVED o REJECTED" })
  status!: "APPROVED" | "REJECTED";

  @ApiPropertyOptional({
    example: "Coordenadas fuera de rango",
    description: "Obligatorio si se rechaza",
  })
  @IsOptional()
  @IsString({ message: "El motivo debe ser texto" })
  @MaxLength(500, { message: "El motivo no puede superar los 500 caracteres" })
  rejectionReason?: string;
}
