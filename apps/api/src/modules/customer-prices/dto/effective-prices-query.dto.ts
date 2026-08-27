import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsUUID } from "class-validator";

export class EffectivePricesQueryDto {
  @ApiPropertyOptional({
    format: "uuid",
    description: "Si se omite, solo se resuelve contra el precio de cliente y el de lista",
  })
  @IsOptional()
  @IsUUID("4", { message: "La ubicación debe ser un identificador válido" })
  locationId?: string;
}
