import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";

export class VoidRoutePitStopDto {
  @ApiProperty({ description: "Motivo de la anulación (obligatorio)" })
  @IsString()
  @IsNotEmpty({ message: "El motivo de anulación es obligatorio" })
  voidReason!: string;
}
