import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsNotEmpty, IsOptional, IsString, Matches } from "class-validator";

export class RescheduleOrdersByDateDto {
  @ApiProperty({
    example: "2026-08-25",
    description:
      "Fecha de entrega original de los pedidos no entregados a reprogramar (AAAA-MM-DD)",
  })
  @IsNotEmpty({ message: "La fecha de origen es obligatoria" })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: "La fecha de origen debe tener formato AAAA-MM-DD",
  })
  deliveryDate!: string;

  @ApiPropertyOptional({
    example: "2026-08-26",
    description:
      "Nueva fecha de entrega (AAAA-MM-DD). Si se omite, se asigna el día siguiente de la fecha de origen.",
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: "La nueva fecha de entrega debe tener formato AAAA-MM-DD",
  })
  newDeliveryDate?: string;
}
