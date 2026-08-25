import { ApiPropertyOptional } from "@nestjs/swagger";
import { Weekday } from "@prisma/client";
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { IsDeliveryDays } from "./delivery-days.validation.js";

/**
 * PATCH semantics: every field optional. Withdrawing a zone is
 * `active: false` here — there is no DELETE route, see ZonesService for
 * why. Reactivating is `active: true`. `deliveryDays` replaces the whole
 * list (it is how the days get decided after the zone was created without
 * them); an empty list is accepted, same reasoning as on creation.
 */
export class UpdateZoneDto {
  @ApiPropertyOptional({ example: "Norte" })
  @IsOptional()
  @IsString({ message: "El nombre es obligatorio" })
  @MinLength(1, { message: "El nombre es obligatorio" })
  @MaxLength(80, { message: "El nombre no puede superar los 80 caracteres" })
  name?: string;

  @ApiPropertyOptional({ enum: Weekday, isArray: true })
  @IsOptional()
  @IsDeliveryDays()
  deliveryDays?: Weekday[];

  @ApiPropertyOptional({ description: "false retira la zona (no se borra la fila)" })
  @IsOptional()
  @IsBoolean({ message: "El estado activo debe ser verdadero o falso" })
  active?: boolean;
}
