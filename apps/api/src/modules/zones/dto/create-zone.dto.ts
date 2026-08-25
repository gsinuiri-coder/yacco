import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Weekday } from "@prisma/client";
import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { IsDeliveryDays } from "./delivery-days.validation.js";

/**
 * A zone is a name and, eventually, its delivery days. `active` is not
 * accepted on creation — a zone is born active, and withdrawing one is a
 * PATCH.
 *
 * `deliveryDays` is OPTIONAL and may be empty on purpose. Delivery days are
 * a routing decision, and routing is a later phase; right now a zone is
 * needed as a grouping to work the container audit by. If creating a zone
 * forced the owner to pick days, they would invent an answer to get past
 * the form, and that invented answer would look like a real fact once
 * routes are built on top of it. An empty array is honest: it says the
 * decision has not been made yet.
 */
export class CreateZoneDto {
  @ApiProperty({ example: "Norte", description: "Nombre único de la zona" })
  @IsString({ message: "El nombre es obligatorio" })
  @MinLength(1, { message: "El nombre es obligatorio" })
  @MaxLength(80, { message: "El nombre no puede superar los 80 caracteres" })
  name!: string;

  @ApiPropertyOptional({
    enum: Weekday,
    isArray: true,
    description: "Días de reparto; puede omitirse o venir vacío hasta que se decida el ruteo",
  })
  @IsOptional()
  @IsDeliveryDays()
  deliveryDays?: Weekday[];
}
