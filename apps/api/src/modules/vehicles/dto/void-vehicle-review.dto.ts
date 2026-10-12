import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class VoidVehicleReviewDto {
  @ApiProperty({
    description: "Motivo de la anulación de la revisión",
    example: "Error en fecha digitada",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  voidReason!: string;
}
