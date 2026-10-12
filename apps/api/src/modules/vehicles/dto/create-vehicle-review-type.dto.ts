import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class CreateVehicleReviewTypeDto {
  @ApiProperty({ description: "Nombre único del tipo de revisión", example: "SOAT" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;
}
