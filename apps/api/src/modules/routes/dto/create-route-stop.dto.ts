import { ApiPropertyOptional, ApiProperty } from "@nestjs/swagger";
import { StopOrigin } from "@prisma/client";
import { IsEnum, IsOptional, IsUUID } from "class-validator";

/**
 * Which of `orderId`/`locationId` is required or forbidden depends on
 * `origin` — a cross-field rule `class-validator` cannot express cleanly
 * against a whitelisted body, so both fields stay simply optional here and
 * RoutesService.addStop enforces the actual combination, the same way
 * OrdersService enforces rules a DTO alone cannot.
 */
export class CreateRouteStopDto {
  @ApiProperty({ enum: StopOrigin })
  @IsEnum(StopOrigin, { message: "El origen debe ser ORDER o VAN_SALE" })
  origin!: StopOrigin;

  @ApiPropertyOptional({ format: "uuid", description: "Obligatorio cuando origin=ORDER" })
  @IsOptional()
  @IsUUID("4", { message: "El pedido debe ser un identificador válido" })
  orderId?: string;

  @ApiPropertyOptional({ format: "uuid", description: "Obligatorio cuando origin=VAN_SALE" })
  @IsOptional()
  @IsUUID("4", { message: "La ubicación debe ser un identificador válido" })
  locationId?: string;
}
