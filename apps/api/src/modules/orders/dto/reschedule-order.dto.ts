import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, Matches } from "class-validator";

export class RescheduleOrderDto {
  @ApiPropertyOptional({
    example: "2026-08-26",
    description: "Fecha de entrega en formato AAAA-MM-DD. Si se omite, se asigna el día siguiente.",
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: "La fecha de entrega debe tener formato AAAA-MM-DD",
  })
  deliveryDate?: string;
}
