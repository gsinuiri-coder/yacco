import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";

export class ReviewPhotoDto {
  @ApiProperty({ enum: ["APPROVED", "REJECTED"], example: "APPROVED" })
  @IsIn(["APPROVED", "REJECTED"], { message: "El estado debe ser APPROVED o REJECTED" })
  status!: "APPROVED" | "REJECTED";

  @ApiPropertyOptional({ example: "Foto borrosa", description: "Obligatorio si se rechaza" })
  @IsOptional()
  @IsString({ message: "El motivo debe ser texto" })
  @MaxLength(500, { message: "El motivo no puede superar los 500 caracteres" })
  rejectionReason?: string;
}
