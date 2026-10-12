import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean } from "class-validator";

export class UpdateVehicleReviewTypeDto {
  @ApiProperty({ description: "Estado activo o desactivado del tipo de revisión", example: true })
  @IsBoolean()
  active!: boolean;
}
