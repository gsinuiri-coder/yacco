import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";

export class RejectPaymentDto {
  @ApiProperty({ example: "El cliente muestra el Yape pero no llegó a la cuenta de la planta" })
  @IsString()
  @IsNotEmpty({ message: "El motivo del rechazo no puede estar vacío" })
  reason!: string;
}
